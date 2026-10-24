<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRemoteRows } from "@/composables/useRemoteRows";
import type { ColumnDef } from "@/types";
import type { VersionRow } from "@/types/api";

const ROW_HEIGHT = 51;
const BUFFER = 10;
const INDEX_WIDTH = 56;

const props = defineProps<{
  versionId: string;
  columns: ColumnDef[];
  rowCount: number;
  q: string;
  sortBy: string | null;
  sortDir: "asc" | "desc";
}>();

const emit = defineEmits<{
  (
    e: "sort-change",
    payload: { sortBy: string; sortDir: "asc" | "desc" }
  ): void;
}>();

const { total, loading, error, loadRange, getRow, refresh } = useRemoteRows(
  () => props.versionId,
  () => ({
    q: props.q,
    sortBy: props.sortBy,
    sortDir: props.sortDir,
  })
);

const bodyRef = ref<HTMLDivElement>();
const visibleStart = ref(0);
const visibleEnd = ref(-1);

const displayTotal = computed(() => total.value ?? props.rowCount);

const totalHeight = computed(() => displayTotal.value * ROW_HEIGHT);

const totalWidth = computed(
  () =>
    INDEX_WIDTH + props.columns.reduce((sum, column) => sum + column.width, 0)
);

const gridTemplate = computed(
  () =>
    `${INDEX_WIDTH}px ${props.columns
      .map((column) => `${column.width}px`)
      .join(" ")}`
);

const visibleRows = computed(() => {
  const result: Array<{
    index: number;
    row: VersionRow | undefined;
  }> = [];

  for (let index = visibleStart.value; index <= visibleEnd.value; index += 1) {
    result.push({ index, row: getRow(index) });
  }

  return result;
});

// 计算展示区域
function updateVisibleRange(): void {
  // #region DOM未挂载/总行数为0 → 不再展示数据
  const el = bodyRef.value;
  if (!el) {
    return;
  }

  const totalCount = displayTotal.value;
  if (totalCount <= 0) {
    visibleStart.value = 0;
    visibleEnd.value = -1;
    return;
  }
  //#endregion

  const viewport = el.clientHeight || 600;

  // 计算边界
  // 1. 0 <= start/end <= totalCount -1
  // 2. start用floor + buffer
  // 3. end用ceil + buffer
  const start = Math.min(
    totalCount - 1,
    Math.max(0, Math.floor(el.scrollTop / ROW_HEIGHT) - BUFFER)
  );
  const end = Math.min(
    totalCount - 1,
    Math.ceil((el.scrollTop + viewport) / ROW_HEIGHT) + BUFFER
  );

  visibleStart.value = start;
  visibleEnd.value = end;
  loadRange(start, end);
}

function handleScroll(): void {
  updateVisibleRange();
}

// FIND
function handleSort(column: ColumnDef): void {
  const sortDir =
    props.sortBy === column.keyName && props.sortDir === "asc" ? "desc" : "asc";

  emit("sort-change", {
    sortBy: column.keyName,
    sortDir,
  });
}

async function handleRefresh(): Promise<void> {
  await refresh();
  await nextTick();

  if (bodyRef.value) {
    bodyRef.value.scrollTop = 0;
  }

  updateVisibleRange();
}

function cellText(row: VersionRow | undefined, keyName: string): string {
  if (!row) {
    return "";
  }

  const value = row[keyName];
  return value === null || value === undefined ? "" : String(value);
}

watch(
  [
    () => props.versionId,
    () => props.q,
    () => props.sortBy,
    () => props.sortDir,
  ],
  async () => {
    await nextTick();

    if (bodyRef.value) {
      bodyRef.value.scrollTop = 0;
    }

    updateVisibleRange();
  }
);

watch(displayTotal, () => {
  void nextTick(() => updateVisibleRange());
});

onMounted(() => {
  void nextTick(() => updateVisibleRange());
  window.addEventListener("resize", updateVisibleRange);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", updateVisibleRange);
});
</script>

<template>
  <section class="remote-table-card">
    <div class="remote-toolbar">
      <span>共 {{ displayTotal.toLocaleString() }} 行</span>
      <div class="toolbar-actions">
        <span v-if="loading" class="loading-text">加载中...</span>
        <button type="button" class="refresh-btn" @click="handleRefresh">
          刷新
        </button>
      </div>
    </div>

    <div v-if="error" class="error-banner">
      <span>{{ error }}</span>
      <button type="button" class="error-retry" @click="handleRefresh">
        重试
      </button>
    </div>

    <div class="table-outer">
      <div class="table-inner" :style="{ width: `${totalWidth}px` }">
        <div
          class="table-header"
          :style="{ gridTemplateColumns: gridTemplate }"
        >
          <div class="index-cell">#</div>
          <button
            v-for="column in columns"
            :key="column.keyName"
            type="button"
            class="header-cell"
            @click="handleSort(column)"
          >
            <span>{{ column.label }}</span>
            <span v-if="sortBy === column.keyName" class="sort-arrow">
              {{ sortDir === "asc" ? "▲" : "▼" }}
            </span>
          </button>
        </div>

        <div ref="bodyRef" class="table-body" @scroll="handleScroll">
          <div class="table-spacer" :style="{ height: `${totalHeight}px` }">
            <div
              v-for="item in visibleRows"
              :key="item.index"
              class="table-row"
              :style="{
                transform: `translateY(${item.index * ROW_HEIGHT}px)`,
                gridTemplateColumns: gridTemplate,
              }"
            >
              <div class="index-cell table-cell">
                {{ item.index + 1 }}
              </div>
              <div
                v-for="column in columns"
                :key="column.keyName"
                class="table-cell"
                :title="cellText(item.row, column.keyName)"
              >
                {{ cellText(item.row, column.keyName) }}
              </div>
            </div>
          </div>

          <div v-if="displayTotal === 0 && !loading" class="empty-state">
            没有数据
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.remote-table-card {
  margin-top: 20px;
  overflow: hidden;
  border: 1px solid rgba(191, 161, 117, 0.15);
  border-radius: 12px;
  background: #fff;
}

.remote-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 18px;
  border-bottom: 1px solid rgba(191, 161, 117, 0.12);
  color: #8a7355;
  font-size: 12px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.loading-text {
  color: #aaa;
}

.refresh-btn,
.error-retry {
  padding: 6px 12px;
  border: 1px solid rgba(191, 161, 117, 0.3);
  border-radius: 6px;
  background: transparent;
  color: #8a7355;
  font-size: 12px;
  cursor: pointer;
}

.error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px;
  border-bottom: 1px solid rgba(245, 108, 108, 0.2);
  background: #fef0f0;
  color: #f56c6c;
  font-size: 12px;
}

.table-outer {
  overflow-x: auto;
}

.table-inner {
  min-width: 100%;
}

.table-header {
  display: grid;
  align-items: center;
  height: 44px;
  background: #faf7f2;
  border-bottom: 1px solid rgba(191, 161, 117, 0.12);
}

.header-cell {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 100%;
  min-width: 0;
  padding: 0 14px;
  overflow: hidden;
  border: none;
  background: transparent;
  color: #8a7355;
  font-size: 12px;
  font-weight: 700;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.header-cell:hover {
  background: rgba(191, 161, 117, 0.06);
}

.sort-arrow {
  font-size: 9px;
}

.index-cell {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 12px;
  color: #bbb;
}

.table-body {
  position: relative;
  height: 62vh;
  min-height: 320px;
  max-height: 640px;
  overflow-x: hidden;
  overflow-y: auto;
}

.table-spacer {
  position: relative;
}

.table-row {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: grid;
  align-items: center;
  height: 51px;
  border-bottom: 1px solid rgba(191, 161, 117, 0.1);
}

.table-row:hover {
  background: rgba(191, 161, 117, 0.03);
}

.table-cell {
  min-width: 0;
  padding: 0 14px;
  overflow: hidden;
  color: #444;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #aaa;
  font-size: 13px;
  pointer-events: none;
}
</style>
