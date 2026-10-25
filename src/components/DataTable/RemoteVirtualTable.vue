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
import { updateVersionCell } from "@/services/versions";
import type { ColumnDef } from "@/types";
import type { VersionRow } from "@/types/api";

const ROW_HEIGHT = 51;
const BUFFER = 10;
const INDEX_WIDTH = 56;
const COMMENT_WIDTH = 72;

const props = defineProps<{
  versionId: string;
  columns: ColumnDef[];
  rowCount: number;
  q: string;
  sortBy: string | null;
  sortDir: "asc" | "desc";
  commentCounts?: Map<number, number>;
  editable?: boolean;
}>();

const emit = defineEmits<{
  (
    e: "sort-change",
    payload: { sortBy: string; sortDir: "asc" | "desc" }
  ): void;
  (e: "row-comment", rowIndex: number): void;
}>();

const { total, loading, error, loadRange, getRow, refresh, applyCellUpdate } =
  useRemoteRows(
    () => props.versionId,
    () => ({
      q: props.q,
      sortBy: props.sortBy,
      sortDir: props.sortDir,
    })
  );

interface VisibleRow {
  index: number;
  row: VersionRow | undefined;
}

interface EditingCell {
  index: number;
  columnKey: string;
}

const rootRef = ref<HTMLElement | null>(null);
const bodyRef = ref<HTMLDivElement>();
const visibleStart = ref(0);
const visibleEnd = ref(-1);

const editingCell = ref<EditingCell | null>(null);
const editValue = ref("");
const saving = ref(false);
const saveError = ref("");

const displayTotal = computed(() => total.value ?? props.rowCount);

const totalHeight = computed(() => displayTotal.value * ROW_HEIGHT);

const totalWidth = computed(
  () =>
    INDEX_WIDTH +
    props.columns.reduce((sum, column) => sum + column.width, 0) +
    COMMENT_WIDTH
);

const gridTemplate = computed(
  () =>
    `${INDEX_WIDTH}px ${COMMENT_WIDTH}px ${props.columns
      .map((column) => `${column.width}px`)
      .join(" ")}`
);

const visibleRows = computed<VisibleRow[]>(() => {
  const result: VisibleRow[] = [];

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
  if (saving.value) {
    return;
  }

  cancelEdit();
  saveError.value = "";
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

function commentCount(rowIndex: number): number {
  return props.commentCounts?.get(rowIndex) ?? 0;
}

function isEditing(index: number, columnKey: string): boolean {
  return (
    editingCell.value?.index === index &&
    editingCell.value.columnKey === columnKey
  );
}

function startEdit(item: VisibleRow, column: ColumnDef): void {
  if (!props.editable || !item.row || saving.value) {
    return;
  }

  saveError.value = "";
  editingCell.value = {
    index: item.index,
    columnKey: column.keyName,
  };
  editValue.value = cellText(item.row, column.keyName);

  void nextTick(() => {
    const input = rootRef.value?.querySelector<HTMLInputElement>(".cell-input");
    input?.focus();
    input?.select();
  });
}

function cancelEdit(): void {
  editingCell.value = null;
  editValue.value = "";
}

async function commitEdit(item: VisibleRow): Promise<void> {
  const editing = editingCell.value;
  if (!editing || editing.index !== item.index) {
    return;
  }

  const row = item.row;
  const nextValue = editValue.value;
  const currentValue = row ? cellText(row, editing.columnKey) : "";
  cancelEdit();

  if (!row || nextValue === currentValue) {
    return;
  }

  saving.value = true;
  saveError.value = "";

  try {
    // 更新后端值
    const data = await updateVersionCell(
      props.versionId,
      row.rowIndex,
      editing.columnKey,
      nextValue
    );

    // 更新前端内存并delete-indexedDB-versionId
    applyCellUpdate(data.cell);
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : "保存单元格失败";
  } finally {
    saving.value = false;
  }
}

function handleRowClick(row: VersionRow | undefined): void {
  if (props.editable || !row) {
    return;
  }

  emit("row-comment", row.rowIndex);
}

function handleRowComment(rowIndex: number): void {
  emit("row-comment", rowIndex);
}

watch(
  [
    () => props.versionId,
    () => props.q,
    () => props.sortBy,
    () => props.sortDir,
  ],
  async () => {
    cancelEdit();
    saveError.value = "";
    await nextTick();

    if (bodyRef.value) {
      bodyRef.value.scrollTop = 0;
    }

    updateVisibleRange();
  }
);

watch(
  () => props.editable,
  (editable) => {
    if (!editable) {
      cancelEdit();
    }
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
  <section ref="rootRef" class="remote-table-card">
    <div class="remote-toolbar">
      <span>共 {{ displayTotal.toLocaleString() }} 行</span>
      <div class="toolbar-actions">
        <span v-if="loading" class="loading-text">加载中...</span>
        <span v-if="saving" class="loading-text">保存中...</span>
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

    <div v-if="saveError" class="error-banner">
      <span>{{ saveError }}</span>
      <button type="button" class="error-retry" @click="saveError = ''">
        关闭
      </button>
    </div>

    <div class="table-outer">
      <div class="table-inner" :style="{ width: `${totalWidth}px` }">
        <div
          class="table-header"
          :style="{ gridTemplateColumns: gridTemplate }"
        >
          <div class="index-cell">#</div>
          <div class="comment-header">评论</div>
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
              :class="{ clickable: Boolean(item.row) && !editable }"
              :style="{
                transform: `translateY(${item.index * ROW_HEIGHT}px)`,
                gridTemplateColumns: gridTemplate,
              }"
              @click="handleRowClick(item.row)"
            >
              <div class="index-cell table-cell">
                {{ item.index + 1 }}
              </div>
              <div class="comment-cell">
                <button
                  v-if="item.row"
                  type="button"
                  class="comment-btn"
                  :class="{
                    active: commentCount(item.row.rowIndex) > 0,
                  }"
                  :title="
                    commentCount(item.row.rowIndex) > 0
                      ? `${commentCount(item.row.rowIndex)} 条评论`
                      : '添加评论'
                  "
                  @click.stop="handleRowComment(item.row.rowIndex)"
                >
                  <span class="comment-icon">💬</span>
                  <span
                    v-if="commentCount(item.row.rowIndex) > 0"
                    class="comment-count"
                  >
                    {{ commentCount(item.row.rowIndex) }}
                  </span>
                </button>
              </div>
              <div
                v-for="column in columns"
                :key="column.keyName"
                class="table-cell"
                :class="{
                  editable: editable,
                  editing: isEditing(item.index, column.keyName),
                }"
                :title="
                  isEditing(item.index, column.keyName)
                    ? undefined
                    : cellText(item.row, column.keyName)
                "
                @dblclick.stop="startEdit(item, column)"
              >
                <input
                  v-if="isEditing(item.index, column.keyName)"
                  v-model="editValue"
                  class="cell-input"
                  type="text"
                  @dblclick.stop
                  @keydown.enter.prevent="commitEdit(item)"
                  @keydown.esc.prevent="cancelEdit"
                  @blur="commitEdit(item)"
                />
                <template v-else>
                  {{ cellText(item.row, column.keyName) }}
                </template>
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

.table-row.clickable {
  cursor: pointer;
}

.table-row:hover {
  background: rgba(191, 161, 117, 0.03);
}

.comment-header,
.comment-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}

.comment-header {
  color: #8a7355;
  font-size: 12px;
  font-weight: 700;
}

.comment-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 7px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #b08a2e;
  font-size: 12px;
  cursor: pointer;
  opacity: 0.3;
  transition: opacity 0.15s, background-color 0.15s;
}

.table-row:hover .comment-btn,
.comment-btn.active {
  opacity: 1;
}

.comment-btn:hover {
  background: rgba(191, 161, 117, 0.1);
}

.comment-icon {
  font-size: 13px;
}

.comment-count {
  min-width: 16px;
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(191, 161, 117, 0.18);
  color: #8a7355;
  font-size: 10px;
  font-weight: 700;
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

.table-cell.editable {
  cursor: cell;
}

.table-cell.editing {
  display: flex;
  align-items: center;
  padding: 0 8px;
  overflow: visible;
}

.cell-input {
  width: 100%;
  height: 32px;
  min-width: 0;
  box-sizing: border-box;
  padding: 0 7px;
  border: 1px solid #bfa175;
  border-radius: 5px;
  outline: none;
  background: #fffdf9;
  color: #333;
  font: inherit;
  box-shadow: 0 0 0 2px rgba(191, 161, 117, 0.12);
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
