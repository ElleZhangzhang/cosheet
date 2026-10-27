<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppSidebar from "@/components/AppSidebar.vue";
import CommentsPanel from "@/components/CommentsPanel.vue";
import RemoteVirtualTable from "@/components/DataTable/RemoteVirtualTable.vue";
import ExportDialog from "@/components/ExportDialog.vue";
import PendingVersionDialog from "@/components/PendingVersionDialog.vue";
import VersionSelector from "@/components/VersionSelector.vue";
import { useRealtime } from "@/composables/useRealtime";
import {
  createComment,
  deleteComment as deleteCommentRequest,
  listComments,
  updateComment as updateCommentRequest,
} from "@/services/comments";
import { getFileDetail } from "@/services/files";
import { clearVersionEdits, retainVersion } from "@/services/versions";
import { useAuthStore } from "@/stores/auth";
import { useWorkspaceStore } from "@/stores/workspace";
import { clearVersionRowCache } from "@/utils/rowCache";
import { getUserColor, getUserInitial } from "@/utils/userColor";
import type { FileDetailResponse, RowComment } from "@/types/api";
import type {
  RealtimeCellEditsCleared,
  RealtimeVersionCreated,
} from "@/types/realtime";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const workspaceStore = useWorkspaceStore();

const detail = ref<FileDetailResponse | null>(null);
const detailLoading = ref(false);
const detailError = ref("");

const searchInput = ref("");
const appliedQuery = ref("");
const sortBy = ref<string | null>(null);
const sortDir = ref<"asc" | "desc">("asc");
const selectedVersionId = ref("");
const tableRef = ref<InstanceType<typeof RemoteVirtualTable> | null>(null);
const tableBusy = ref(false);
const hasPendingEdits = ref(false);
const retaining = ref(false);
const clearing = ref(false);
const versionActionError = ref("");
const tableResetKey = ref(0);
const exportOpen = ref(false);
const pendingVersionDialogOpen = ref(false);

const comments = ref<RowComment[]>([]);
const commentsLoading = ref(false);
const commentsError = ref("");
const commentsOpen = ref(false);
const commentRowIndex = ref<number | null>(null);
const commentSubmitting = ref(false);
const commentActionError = ref("");

let searchTimer: number | undefined;
let commentsRequestId = 0;

const latestVersion = computed(() => detail.value?.latestVersion ?? null);

const selectedVersion = computed(() => {
  const versions = detail.value?.versions ?? [];

  return (
    versions.find((version) => version.id === selectedVersionId.value) ??
    latestVersion.value
  );
});

const isHistorical = computed(() =>
  Boolean(
    selectedVersion.value &&
      latestVersion.value &&
      selectedVersion.value.id !== latestVersion.value.id
  )
);

const columns = computed(() => selectedVersion.value?.columns ?? []);

const currentRole = computed(() => workspaceStore.currentWorkspace?.role);

const isOwner = computed(() => currentRole.value === "owner");

const canEdit = computed(() => {
  const role = currentRole.value;
  return role === "owner" || role === "editor";
});

const canRetain = computed(
  () =>
    isOwner.value &&
    Boolean(selectedVersion.value) &&
    selectedVersion.value?.status === "ready" &&
    hasPendingEdits.value &&
    !tableBusy.value &&
    !retaining.value &&
    !clearing.value
);

const canClear = computed(
  () =>
    isOwner.value &&
    Boolean(selectedVersion.value) &&
    selectedVersion.value?.status === "ready" &&
    hasPendingEdits.value &&
    !tableBusy.value &&
    !retaining.value &&
    !clearing.value
);

watch(
  selectedVersion,
  (version) => {
    hasPendingEdits.value = (version?.pendingEditCount ?? 0) > 0;
  },
  { immediate: true }
);

const canComment = computed(() => {
  const role = currentRole.value;
  return role === "owner" || role === "editor" || role === "commenter";
});

const canResolveAny = computed(
  () => currentRole.value === "owner" || currentRole.value === "editor"
);

const canDeleteAny = computed(() => currentRole.value === "owner");

const currentUserId = computed(() => authStore.user?.id ?? "");

const commentCounts = computed(() => {
  const counts = new Map<number, number>();

  for (const comment of comments.value) {
    counts.set(comment.rowIndex, (counts.get(comment.rowIndex) ?? 0) + 1);
  }

  return counts;
});

const commentsForRow = computed(() => {
  if (commentRowIndex.value === null) {
    return [];
  }

  return comments.value.filter(
    (comment) => comment.rowIndex === commentRowIndex.value
  );
});

const panelError = computed(
  () => commentsError.value || commentActionError.value
);

const fileId = computed(() => {
  const value = route.params.fileId;
  return typeof value === "string" ? value : "";
});

const sortLabel = computed(() => {
  if (!sortBy.value) {
    return "";
  }

  const column = columns.value.find((item) => item.keyName === sortBy.value);

  return column?.label ?? sortBy.value;
});

const {
  connected: realtimeConnected,
  joined: realtimeJoined,
  presence,
  cursors,
  error: realtimeError,
  sendCursor,
  clearCursor,
} = useRealtime(() => selectedVersion.value?.id ?? null, {
  onCellUpdate: (update) => {
    tableRef.value?.applyCellUpdate(update.cell);
    hasPendingEdits.value = true;
  },
  onVersionCreated: handleVersionCreated,
  onCellEditsCleared: handleCellEditsCleared,
});

const visiblePresence = computed(() => presence.value.slice(0, 5));

const extraOnlineCount = computed(() => Math.max(0, presence.value.length - 5));

const realtimeStatus = computed(() => {
  if (realtimeError.value) {
    return "error";
  }

  return realtimeJoined.value ? "online" : "waiting";
});

const realtimeLabel = computed(() => {
  if (realtimeError.value) {
    return "实时连接异常";
  }
  if (realtimeJoined.value) {
    return `在线 ${presence.value.length}`;
  }
  if (realtimeConnected.value) {
    return "加入中...";
  }

  return selectedVersion.value ? "连接中..." : "";
});

function resetQuery(): void {
  if (searchTimer !== undefined) {
    window.clearTimeout(searchTimer);
    searchTimer = undefined;
  }

  searchInput.value = "";
  appliedQuery.value = "";
  sortBy.value = null;
  sortDir.value = "asc";
}

async function loadFile(): Promise<void> {
  const id = fileId.value;
  if (!id) {
    return;
  }

  detailLoading.value = true;
  detailError.value = "";
  versionActionError.value = "";
  detail.value = null;
  tableBusy.value = false;
  resetQuery();

  try {
    const data = await getFileDetail(id);
    detail.value = data;
    selectedVersionId.value = data.latestVersion?.id ?? "";

    await workspaceStore.loadWorkspaces();
    workspaceStore.selectWorkspace(data.file.workspaceId);
  } catch (err) {
    detailError.value = err instanceof Error ? err.message : "加载文件失败";
  } finally {
    detailLoading.value = false;
  }
}

function handleSortChange(payload: {
  sortBy: string;
  sortDir: "asc" | "desc";
}): void {
  sortBy.value = payload.sortBy;
  sortDir.value = payload.sortDir;
}

function handleCursorChange(payload: {
  rowIndex: number;
  columnKey: string | null;
}): void {
  sendCursor(payload.rowIndex, payload.columnKey);
}

function handleCursorClear(): void {
  clearCursor();
}

function handleVersionChange(versionId: string): void {
  const version = detail.value?.versions.find((item) => item.id === versionId);

  if (!version || version.status !== "ready") {
    return;
  }

  selectedVersionId.value = version.id;
  versionActionError.value = "";
  tableBusy.value = false;
  resetQuery();
}

function handleTableCellSaved(versionId: string): void {
  if (selectedVersion.value?.id === versionId) {
    hasPendingEdits.value = true;
  }
}

function handleTableBusy(busy: boolean): void {
  tableBusy.value = busy;
}

async function switchToVersion(
  versionId: string,
  sourceVersionId: string
): Promise<void> {
  if (!fileId.value || selectedVersionId.value === versionId) {
    return;
  }
  if (selectedVersionId.value !== sourceVersionId) {
    return;
  }

  try {
    const data = await getFileDetail(fileId.value);
    detail.value = data;

    if (
      selectedVersionId.value !== sourceVersionId ||
      !data.versions.some(
        (version) => version.id === versionId && version.status === "ready"
      )
    ) {
      return;
    }

    selectedVersionId.value = versionId;
    hasPendingEdits.value = false;
    versionActionError.value = "";
    resetQuery();
  } catch {
    versionActionError.value = "版本已更新，但刷新文件失败，请刷新页面";
  }
}

function handleVersionCreated(event: RealtimeVersionCreated): void {
  if (event.file.id !== fileId.value) {
    return;
  }

  if (selectedVersion.value?.id !== event.sourceVersionId) {
    return;
  }

  void switchToVersion(event.version.id, event.sourceVersionId);
}

async function retainCurrentVersion(): Promise<string | null> {
  const version = selectedVersion.value;

  if (
    !version ||
    !isOwner.value ||
    retaining.value ||
    clearing.value
  ) {
    return null;
  }

  retaining.value = true;
  versionActionError.value = "";

  try {
    const result = await retainVersion(version.id);
    await switchToVersion(result.version.id, version.id);

    if (selectedVersionId.value !== result.version.id) {
      versionActionError.value =
        "保留成功，但版本切换失败，请刷新页面";
      return null;
    }

    return result.version.id;
  } catch (err) {
    versionActionError.value =
      err instanceof Error ? err.message : "保留版本失败";
    return null;
  } finally {
    retaining.value = false;
  }
}

async function handleRetainVersion(): Promise<void> {
  if (!canRetain.value) {
    return;
  }

  await retainCurrentVersion();
}

function handleExportClick(): void {
  if (
    !selectedVersion.value ||
    tableBusy.value ||
    retaining.value ||
    clearing.value
  ) {
    return;
  }

  if (!hasPendingEdits.value) {
    exportOpen.value = true;
    return;
  }

  if (!isOwner.value) {
    versionActionError.value =
      "当前版本有未保留修改，请等待 owner 保留或清除后再导出";
    return;
  }

  pendingVersionDialogOpen.value = true;
}

async function handlePendingRetain(): Promise<void> {
  pendingVersionDialogOpen.value = false;
  const newVersionId = await retainCurrentVersion();

  if (newVersionId) {
    exportOpen.value = true;
  }
}

async function handlePendingClear(): Promise<void> {
  pendingVersionDialogOpen.value = false;
  await clearCurrentVersionEdits();
}

const clearingVersions = new Set<string>();

// 用户点击“清除改动” → 后端删除cell_edits相关内容 → 前端删除cache相关内容 + 重新getFileDetail获取数据
async function applyCellEditsCleared(
  event: RealtimeCellEditsCleared
): Promise<void> {
  const versionId = event.versionId;
  const version = selectedVersion.value;

  if (!version || version.id !== versionId) {
    return;
  }
  if (!hasPendingEdits.value && version.pendingEditCount === 0) {
    return;
  }
  if (clearingVersions.has(versionId)) {
    return;
  }

  clearingVersions.add(versionId);
  let refreshError = "";

  try {
    await clearVersionRowCache(versionId);

    try {
      const data = await getFileDetail(fileId.value);
      detail.value = data;
    } catch {
      refreshError = "改动已清除，但刷新文件失败，请刷新页面";
    }

    if (selectedVersion.value?.id !== versionId) {
      return;
    }

    hasPendingEdits.value = false;
    tableResetKey.value += 1;
    versionActionError.value = refreshError;
  } finally {
    clearingVersions.delete(versionId);
  }
}

function handleCellEditsCleared(event: RealtimeCellEditsCleared): void {
  if (event.versionId !== selectedVersion.value?.id) {
    return;
  }

  void applyCellEditsCleared(event);
}

async function clearCurrentVersionEdits(): Promise<boolean> {
  const version = selectedVersion.value;

  if (
    !version ||
    !isOwner.value ||
    clearing.value ||
    retaining.value
  ) {
    return false;
  }

  clearing.value = true;
  versionActionError.value = "";

  try {
    const result = await clearVersionEdits(version.id);
    await applyCellEditsCleared({
      versionId: result.versionId,
      cleared: result.cleared,
    });
    return true;
  } catch (err) {
    versionActionError.value =
      err instanceof Error ? err.message : "清除改动失败";
    return false;
  } finally {
    clearing.value = false;
  }
}

async function handleClearChanges(): Promise<void> {
  if (!canClear.value) {
    return;
  }

  if (!window.confirm("确定清除当前版本的所有未保留修改吗？")) {
    return;
  }

  await clearCurrentVersionEdits();
}

async function loadComments(versionId: string): Promise<void> {
  if (!fileId.value || !versionId) {
    comments.value = [];
    return;
  }

  const requestId = ++commentsRequestId;
  commentsLoading.value = true;
  commentsError.value = "";

  try {
    const data = await listComments(fileId.value, versionId);

    if (requestId !== commentsRequestId) {
      return;
    }

    comments.value = data.comments;
  } catch (err) {
    if (requestId !== commentsRequestId) {
      return;
    }

    commentsError.value = err instanceof Error ? err.message : "加载评论失败";
  } finally {
    if (requestId === commentsRequestId) {
      commentsLoading.value = false;
    }
  }
}

function handleRowComment(rowIndex: number): void {
  commentRowIndex.value = rowIndex;
  commentsOpen.value = true;
  commentActionError.value = "";
}

async function handleCreateComment(content: string): Promise<void> {
  const version = selectedVersion.value;
  const rowIndex = commentRowIndex.value;

  if (
    !version ||
    rowIndex === null ||
    !canComment.value ||
    commentSubmitting.value
  ) {
    return;
  }

  commentSubmitting.value = true;
  commentActionError.value = "";

  try {
    await createComment(fileId.value, {
      versionId: version.id,
      rowIndex,
      content,
    });
    await loadComments(version.id);
  } catch (err) {
    commentActionError.value =
      err instanceof Error ? err.message : "创建评论失败";
  } finally {
    commentSubmitting.value = false;
  }
}

async function handleToggleCommentResolved(
  comment: RowComment,
  resolved: boolean
): Promise<void> {
  if (commentSubmitting.value) {
    return;
  }

  commentSubmitting.value = true;
  commentActionError.value = "";

  try {
    await updateCommentRequest(comment.id, resolved);

    if (selectedVersion.value) {
      await loadComments(selectedVersion.value.id);
    }
  } catch (err) {
    commentActionError.value =
      err instanceof Error ? err.message : "更新评论失败";
  } finally {
    commentSubmitting.value = false;
  }
}

async function handleDeleteComment(comment: RowComment): Promise<void> {
  if (commentSubmitting.value) {
    return;
  }

  if (!confirm("确定删除这条评论吗？")) {
    return;
  }

  commentSubmitting.value = true;
  commentActionError.value = "";

  try {
    await deleteCommentRequest(comment.id);

    if (selectedVersion.value) {
      await loadComments(selectedVersion.value.id);
    }
  } catch (err) {
    commentActionError.value =
      err instanceof Error ? err.message : "删除评论失败";
  } finally {
    commentSubmitting.value = false;
  }
}

watch(
  () => selectedVersion.value?.id ?? "",
  (versionId) => {
    commentsRequestId += 1;
    commentsOpen.value = false;
    commentRowIndex.value = null;
    commentActionError.value = "";

    if (versionId) {
      void loadComments(versionId);
    } else {
      comments.value = [];
      commentsLoading.value = false;
      commentsError.value = "";
    }
  },
  { immediate: true }
);

function goBack(): void {
  const workspaceId =
    detail.value?.file.workspaceId ?? workspaceStore.currentWorkspaceId;

  if (workspaceId) {
    router.push(`/workspaces/${workspaceId}`);
  } else {
    router.push("/workspaces");
  }
}

// LIGHT 搜索300ms防抖
watch(searchInput, () => {
  if (searchTimer !== undefined) {
    window.clearTimeout(searchTimer);
  }

  searchTimer = window.setTimeout(() => {
    appliedQuery.value = searchInput.value.trim();
  }, 300);
});

onBeforeUnmount(() => {
  if (searchTimer !== undefined) {
    window.clearTimeout(searchTimer);
  }
});

onMounted(() => {
  void loadFile();
});

watch(
  () => route.params.fileId,
  () => {
    void loadFile();
  }
);
</script>

<template>
  <div class="workspace-layout">
    <AppSidebar />

    <main class="file-main">
      <div v-if="detailLoading" class="status-card">正在加载文件...</div>

      <div v-else-if="detailError" class="status-card error">
        <p>{{ detailError }}</p>
        <div class="error-actions">
          <button type="button" class="ghost-btn" @click="goBack">
            返回工作空间
          </button>
          <button type="button" class="retry-btn" @click="loadFile">
            重试
          </button>
        </div>
      </div>

      <template v-else-if="detail">
        <header class="file-header">
          <div class="file-title">
            <button type="button" class="back-btn" @click="goBack">
              ← 返回
            </button>
            <div class="title-text">
              <h1>{{ detail.file.name }}</h1>
              <p class="file-meta">
                <template v-if="selectedVersion">
                  v{{ selectedVersion.versionNumber }} ·
                  {{ selectedVersion.rowCount.toLocaleString() }} 行 ·
                  {{ selectedVersion.columns.length }} 列 ·
                  {{ selectedVersion.chunkCount }} 个分片
                </template>
                <template v-else>还没有 ready 版本</template>
              </p>
            </div>
          </div>

          <div class="header-actions">
            <div
              v-if="selectedVersion"
              class="realtime-status"
              :title="realtimeError || undefined"
            >
              <span class="realtime-dot" :class="realtimeStatus"></span>
              <span class="realtime-label">{{ realtimeLabel }}</span>
              <div v-if="presence.length > 0" class="online-avatars">
                <span
                  v-for="user in visiblePresence"
                  :key="user.userId"
                  class="online-avatar"
                  :style="{ backgroundColor: getUserColor(user.userId) }"
                  :title="
                    user.userId === currentUserId
                      ? `${user.name}（你）`
                      : user.name
                  "
                >
                  {{ getUserInitial(user.name) }}
                </span>
                <span v-if="extraOnlineCount > 0" class="online-more">
                  +{{ extraOnlineCount }}
                </span>
              </div>
            </div>
            <VersionSelector
              v-if="latestVersion"
              :versions="detail.versions"
              :selected-version-id="selectedVersionId"
              @change="handleVersionChange"
            />
            <button
              v-if="selectedVersion"
              type="button"
              class="export-version-btn"
              :disabled="tableBusy || retaining || clearing"
              title="导出当前版本"
              @click="handleExportClick"
            >
              导出
            </button>
            <button
              v-if="isOwner && selectedVersion"
              type="button"
              class="clear-edits-btn"
              :disabled="!canClear"
              :title="
                !hasPendingEdits
                  ? '没有可清除的修改'
                  : tableBusy
                  ? '请先结束当前编辑'
                  : clearing
                  ? '正在清除改动'
                  : retaining
                  ? '正在保留版本'
                  : '清除当前版本的所有未保留修改'
              "
              @click="handleClearChanges"
            >
              {{ clearing ? "清除中..." : "清除改动" }}
            </button>
            <button
              v-if="isOwner && selectedVersion"
              type="button"
              class="retain-version-btn"
              :class="{ pending: hasPendingEdits }"
              :disabled="!canRetain"
              :title="
                !hasPendingEdits
                  ? '没有未保留的修改'
                  : tableBusy
                  ? '请先结束当前编辑'
                  : retaining
                  ? '正在保留版本'
                  : clearing
                  ? '正在清除改动'
                  : '把当前版本的草稿保存为新版本'
              "
              @click="handleRetainVersion"
            >
              {{ retaining ? "保留中..." : "保留版本" }}
            </button>
            <span
              v-if="selectedVersion"
              class="status-badge"
              :class="isHistorical ? 'historical' : 'ready'"
            >
              {{ isHistorical ? "历史版本" : "就绪" }}
            </span>
          </div>
        </header>

        <div v-if="versionActionError" class="retain-error">
          <span>{{ versionActionError }}</span>
          <button type="button" @click="versionActionError = ''">关闭</button>
        </div>

        <section v-if="!selectedVersion" class="status-card">
          文件还没有完成上传，暂时不能查看表格。
        </section>

        <template v-else>
          <div class="table-controls">
            <input
              v-model="searchInput"
              class="search-input"
              type="search"
              placeholder="搜索表格内容"
            />
            <span v-if="sortBy" class="sort-info">
              排序：{{ sortLabel }}
              {{ sortDir === "asc" ? "升序" : "降序" }}
            </span>
          </div>

          <!-- LIGHT 虚拟滚动 -->
          <RemoteVirtualTable
            ref="tableRef"
            :key="`${selectedVersion.id}:${tableResetKey}`"
            :version-id="selectedVersion.id"
            :columns="columns"
            :row-count="selectedVersion.rowCount"
            :q="appliedQuery"
            :sort-by="sortBy"
            :sort-dir="sortDir"
            :comment-counts="commentCounts"
            :editable="canEdit"
            :cursors="cursors"
            @sort-change="handleSortChange"
            @row-comment="handleRowComment"
            @cursor-change="handleCursorChange"
            @cursor-clear="handleCursorClear"
            @cell-saved="handleTableCellSaved"
            @busy-change="handleTableBusy"
          />
        </template>
      </template>
    </main>

    <PendingVersionDialog
      :open="pendingVersionDialogOpen"
      @retain="handlePendingRetain"
      @clear="handlePendingClear"
      @close="pendingVersionDialogOpen = false"
    />

    <ExportDialog
      v-if="detail && selectedVersion"
      v-model:open="exportOpen"
      :version-id="selectedVersion.id"
      :version-number="selectedVersion.versionNumber"
      :file-name="detail.file.name"
      :columns="columns"
      :row-count="selectedVersion.rowCount"
    />

    <CommentsPanel
      v-if="detail"
      :open="commentsOpen"
      :row-index="commentRowIndex ?? 0"
      :comments="commentsForRow"
      :loading="commentsLoading"
      :error="panelError"
      :submitting="commentSubmitting"
      :can-comment="canComment"
      :can-resolve-any="canResolveAny"
      :can-delete-any="canDeleteAny"
      :current-user-id="currentUserId"
      @close="commentsOpen = false"
      @create="handleCreateComment"
      @toggle-resolve="handleToggleCommentResolved"
      @delete="handleDeleteComment"
    />
  </div>
</template>

<style scoped>
.workspace-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: #f9f6f1;
  color: #333;
  font-family: "PingFang SC", "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.file-main {
  flex: 1;
  overflow-y: auto;
  padding: 40px;
}

.status-card {
  padding: 24px;
  border: 1px solid rgba(191, 161, 117, 0.2);
  border-radius: 12px;
  background: #fff;
  color: #888;
  font-size: 14px;
}

.status-card.error {
  color: #f56c6c;
}

.status-card.error p {
  margin: 0 0 12px;
}

.error-actions {
  display: flex;
  gap: 10px;
}

.retry-btn,
.ghost-btn,
.back-btn {
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.retry-btn,
.back-btn {
  border: 1px solid rgba(191, 161, 117, 0.3);
  background: transparent;
  color: #8a7355;
}

.ghost-btn {
  border: 1px solid #e6e0d8;
  background: transparent;
  color: #777;
}

.file-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 28px;
  border: 1px solid rgba(191, 161, 117, 0.15);
  border-radius: 12px;
  background: #fff;
}

.file-title {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.title-text {
  min-width: 0;
}

.title-text h1 {
  margin: 0;
  overflow: hidden;
  font-size: 24px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-meta {
  margin: 6px 0 0;
  color: #999;
  font-size: 13px;
}

.status-badge {
  flex-shrink: 0;
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.status-badge.ready {
  background: #f0f9eb;
  color: #67c23a;
}

.status-badge.historical {
  background: #f4f4f5;
  color: #909399;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.realtime-status {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.realtime-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #e6a23c;
}

.realtime-dot.online {
  background: #67c23a;
}

.realtime-dot.error {
  background: #f56c6c;
}

.realtime-label {
  color: #8a7355;
  font-size: 12px;
  white-space: nowrap;
}

.online-avatars {
  display: flex;
  align-items: center;
  margin-left: 2px;
}

.online-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: -6px;
  border: 2px solid #fff;
  border-radius: 50%;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.online-avatar:first-child {
  margin-left: 0;
}

.online-more {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  margin-left: -6px;
  padding: 0 5px;
  box-sizing: border-box;
  border: 2px solid #fff;
  border-radius: 999px;
  background: #e9e1d6;
  color: #8a7355;
  font-size: 10px;
  font-weight: 700;
}

.export-version-btn {
  padding: 7px 12px;
  border: 1px solid rgba(191, 161, 117, 0.35);
  border-radius: 7px;
  background: #fffdf9;
  color: #8a7355;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}

.export-version-btn:hover:not(:disabled) {
  background: rgba(191, 161, 117, 0.1);
}

.export-version-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.clear-edits-btn {
  padding: 7px 12px;
  border: 1px solid rgba(245, 108, 108, 0.3);
  border-radius: 7px;
  background: transparent;
  color: #d05c5c;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}

.clear-edits-btn:hover:not(:disabled) {
  background: #fef0f0;
}

.clear-edits-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.retain-version-btn {
  padding: 7px 12px;
  border: 1px solid rgba(191, 161, 117, 0.35);
  border-radius: 7px;
  background: rgba(191, 161, 117, 0.08);
  color: #8a7355;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}

.retain-version-btn.pending {
  border-color: #bfa175;
  background: #bfa175;
  color: #fff;
}

.retain-version-btn:hover:not(:disabled) {
  background: rgba(191, 161, 117, 0.2);
}

.retain-version-btn.pending:hover:not(:disabled) {
  background: #b18f5f;
}

.retain-version-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.retain-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding: 10px 14px;
  border: 1px solid rgba(245, 108, 108, 0.2);
  border-radius: 8px;
  background: #fef0f0;
  color: #f56c6c;
  font-size: 12px;
}

.retain-error button {
  border: none;
  background: transparent;
  color: #f56c6c;
  font-size: 12px;
  cursor: pointer;
}

.table-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 20px;
}

.search-input {
  width: 280px;
  box-sizing: border-box;
  padding: 9px 12px;
  border: 1px solid #e6e0d8;
  border-radius: 8px;
  background: #fffdf9;
  color: #333;
  font-size: 13px;
  outline: none;
}

.search-input:focus {
  border-color: #bfa175;
  box-shadow: 0 0 0 3px rgba(191, 161, 117, 0.12);
}

.sort-info {
  color: #8a7355;
  font-size: 12px;
}
</style>
