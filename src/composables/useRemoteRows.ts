// 前端数据虚拟化加载与缓存：在渲染几十万行的云端大表格时，实现“滚动到哪里，就加载哪里的数据（按需加载）”，并且用 IndexedDB 做本地缓存，避免重复请求网络
// 实现：
// 按需加载：滑到哪加载哪，不卡死浏览器
// 内存级防抖：同一页正在请求时，不会重复发
// 磁盘级缓存：看过的页存 IndexedDB，下拉再上去秒开
// 竞态防护：快速切换条件时，旧数据不会覆盖新数据

import {
  onScopeDispose,
  reactive,
  ref,
  watch,
} from "vue";
import { getVersionRows } from "@/services/versions";
import {
  clearVersionRowCache,
  getCachedRowPage,
  setCachedRowPage,
} from "@/utils/rowCache";
import type { VersionRow } from "@/types/api";

const PAGE_SIZE = 200;

interface RemoteRowsQuery {
  q: string;
  sortBy: string | null;
  sortDir: "asc" | "desc";
}

interface CellUpdate {
  rowIndex: number;
  columnKey: string;
  value: unknown;
  revision: number;
}

interface AppliedCellEdit {
  value: unknown;
  revision: number;
}

function normalizeQuery(query: RemoteRowsQuery): RemoteRowsQuery {
  return {
    q: query.q.trim(),
    sortBy: query.sortBy,
    sortDir: query.sortDir,
  };
}

function buildQueryKey(query: RemoteRowsQuery): string {
  return JSON.stringify(query);
}

function useRemoteRows(
  getVersionId: () => string | null,
  getQuery: () => RemoteRowsQuery
) {
  const rows = reactive(new Map<number, VersionRow>());
  const total = ref<number | null>(null);
  const loading = ref(false);
  const error = ref("");

  // 防竞态请求
  let requestToken = 0;

  let loadedVersionId = "";
  let loadedQueryKey = "";
  let currentQuery: RemoteRowsQuery = {
    q: "",
    sortBy: null,
    sortDir: "asc",
  };

  // 已经加载过的页码偏移量
  const loadedOffsets = new Set<number>();
  // 记录正在请求中的页码，防止重复发送请求
  const pendingOffsets = new Map<number, Promise<void>>();
  let pendingCount = 0;

  // 当前版本已应用的单元格编辑；后续加载的页也要覆盖上去
  const cellEdits = new Map<number, Map<string, AppliedCellEdit>>();

  function resetState(): void {
    rows.clear();
    total.value = null;
    loading.value = false;
    error.value = "";
    loadedOffsets.clear();
    pendingOffsets.clear();
    pendingCount = 0;
    cellEdits.clear();
  }

  function applyKnownEdits(row: VersionRow): void {
    const rowEdits = cellEdits.get(row.rowIndex);
    if (!rowEdits) {
      return;
    }

    for (const [columnKey, edit] of rowEdits) {
      row[columnKey] = edit.value;
    }
  }

  // 单页加载
  async function loadPage(
    offset: number,
    token: number,
    versionId: string,
    queryKey: string,
    query: RemoteRowsQuery
  ): Promise<void> {
    // 防止用户快速上下滑动时，同一页数据被重复请求
    const existing = pendingOffsets.get(offset);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      pendingCount += 1;
      loading.value = true;

      try {
        // #region 查缓存
        const cached = await getCachedRowPage(
          versionId,
          queryKey,
          offset,
          PAGE_SIZE
        );

        // FIND
        if (token !== requestToken) {
          return;
        }

        if (cached) {
          total.value = cached.total;
          cached.rows.forEach((row, index) => {
            applyKnownEdits(row);
            rows.set(cached.offset + index, row);
          });
          loadedOffsets.add(offset);
          return;
        }
        //#endregion

        // #region 没缓存 → 请求服务器 + 缓存
        const data = await getVersionRows(versionId, {
          offset,
          limit: PAGE_SIZE,
          q: query.q || undefined,
          sortBy: query.sortBy ?? undefined,
          sortDir: query.sortBy ? query.sortDir : undefined,
        });

        // 请求数据回来时比对令牌，已改变则丢弃数据
        if (token !== requestToken) {
          return;
        }

        total.value = data.total;
        data.rows.forEach((row, index) => {
          // 服务端返回的是展示顺序；rowIndex 是原始行号，不能直接当显示位置
          applyKnownEdits(row);
          rows.set(offset + index, row);
        });
        loadedOffsets.add(offset);

        await setCachedRowPage({
          versionId,
          queryKey,
          offset,
          limit: PAGE_SIZE,
          total: data.total,
          rows: data.rows,
        });
        //#endregion
      } catch (err) {
        if (token === requestToken) {
          error.value =
            err instanceof Error ? err.message : "加载行数据失败";
        }
      } finally {
        if (token === requestToken) {
          pendingOffsets.delete(offset);
          pendingCount -= 1;

          if (pendingCount <= 0) {
            pendingCount = 0;
            loading.value = false;
          }
        }
      }
    })();

    pendingOffsets.set(offset, promise);
    return promise;
  }

  // 计算加载范围 → 单页加载
  function loadRange(start: number, end: number): void {
    const versionId = getVersionId();
    if (!versionId) {
      return;
    }

    const maxIndex = (total.value ?? Number.POSITIVE_INFINITY) - 1;
    if (maxIndex < 0) {
      return;
    }

    const from = Math.max(0, Math.min(start, maxIndex));
    const to = Math.max(0, Math.min(end, maxIndex));
    if (to < from) {
      return;
    }

    const token = requestToken;
    const queryKey = loadedQueryKey;
    const query = currentQuery;
    const firstOffset = Math.floor(from / PAGE_SIZE) * PAGE_SIZE;
    const lastOffset = Math.floor(to / PAGE_SIZE) * PAGE_SIZE;

    for (let offset = firstOffset; offset <= lastOffset; offset += PAGE_SIZE
    ) {
      if (loadedOffsets.has(offset) || pendingOffsets.has(offset)) {
        continue;
      }

      void loadPage(offset, token, versionId, queryKey, query);
    }
  }

  function sync(): void {
    const versionId = getVersionId() ?? "";
    const query = normalizeQuery(getQuery());
    const queryKey = buildQueryKey(query);

    if (
      versionId === loadedVersionId &&
      queryKey === loadedQueryKey
    ) {
      return;
    }

    requestToken += 1;
    resetState();

    loadedVersionId = versionId;
    loadedQueryKey = queryKey;
    currentQuery = query;

    if (!versionId) {
      return;
    }

    loadRange(0, PAGE_SIZE - 1);
  }

  // 用户手动点击刷新 → 清空本地缓存 + 拉取后端数据加载第一页
  async function refresh(): Promise<void> {
    const versionId = getVersionId();

    if (versionId) {
      await clearVersionRowCache(versionId);
    }

    requestToken += 1;
    resetState();
    loadedVersionId = "";
    loadedQueryKey = "";
    sync();
  }

  function getRow(index: number): VersionRow | undefined {
    return rows.get(index);
  }

  // 单元格保存/实时更新 → 同步已加载的行 + 失效versionId对应的行缓存
  // OPTIMIZE 让所有的versionId都失效太过，精确到offset很不错
  function applyCellUpdate(update: CellUpdate): void {
    let rowEdits = cellEdits.get(update.rowIndex);
    const existing = rowEdits?.get(update.columnKey);

    if (existing && existing.revision > update.revision) {
      return;
    }

    if (!rowEdits) {
      rowEdits = new Map();
      cellEdits.set(update.rowIndex, rowEdits);
    }
    rowEdits.set(update.columnKey, {
      value: update.value,
      revision: update.revision,
    });

    for (const row of rows.values()) {
      if (row.rowIndex === update.rowIndex) {
        row[update.columnKey] = update.value;
      }
    }

    const versionId = getVersionId();
    if (versionId) {
      void clearVersionRowCache(versionId);
    }
  }

  // 当用户切换了版本，或者输入了搜索词时，说明数据源变了。此时必须清空原来的内存数据，让所有还在跑的请求作废，然后重新加载第一页
  watch(
    [
      () => getVersionId(),
      () => getQuery().q,
      () => getQuery().sortBy,
      () => getQuery().sortDir,
    ],
    () => sync(),
    { immediate: true }
  );

  onScopeDispose(() => {
    requestToken += 1;
  });

  return {
    total,
    loading,
    error,
    loadRange,
    getRow,
    refresh,
    applyCellUpdate,
  };
}

export { useRemoteRows, PAGE_SIZE };
export type { RemoteRowsQuery, CellUpdate };
