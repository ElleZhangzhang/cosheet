<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppSidebar from "@/components/AppSidebar.vue";
import CommentsPanel from "@/components/CommentsPanel.vue";
import RemoteVirtualTable from "@/components/DataTable/RemoteVirtualTable.vue";
import FileUploadDialog from "@/components/FileUploadDialog.vue";
import VersionSelector from "@/components/VersionSelector.vue";
import {
  createComment,
  deleteComment as deleteCommentRequest,
  listComments,
  updateComment as updateCommentRequest,
} from "@/services/comments";
import { getFileDetail } from "@/services/files";
import { useAuthStore } from "@/stores/auth";
import { useWorkspaceStore } from "@/stores/workspace";
import type { FileDetailResponse, RowComment } from "@/types/api";

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
const uploadOpen = ref(false);

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

const currentRole = computed(
  () => workspaceStore.currentWorkspace?.role
);

const canUpload = computed(() => {
  const role = currentRole.value;
  return role === "owner" || role === "editor";
});

const canEdit = computed(
  () => canUpload.value && !isHistorical.value
);

const canComment = computed(() => {
  const role = currentRole.value;
  return (
    role === "owner" || role === "editor" || role === "commenter"
  );
});

const canResolveAny = computed(
  () => currentRole.value === "owner" || currentRole.value === "editor"
);

const canDeleteAny = computed(() => currentRole.value === "owner");

const currentUserId = computed(() => authStore.user?.id ?? "");

const commentCounts = computed(() => {
  const counts = new Map<number, number>();

  for (const comment of comments.value) {
    counts.set(
      comment.rowIndex,
      (counts.get(comment.rowIndex) ?? 0) + 1
    );
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
  detail.value = null;
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

function handleVersionChange(versionId: string): void {
  const version = detail.value?.versions.find((item) => item.id === versionId);

  if (!version || version.status !== "ready") {
    return;
  }

  selectedVersionId.value = version.id;
  resetQuery();
}

async function handleVersionUploaded(): Promise<void> {
  uploadOpen.value = false;
  await loadFile();
}

async function handleVersionUploadCancelled(): Promise<void> {
  uploadOpen.value = false;
  await loadFile();
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

    commentsError.value =
      err instanceof Error ? err.message : "加载评论失败";
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

async function handleDeleteComment(
  comment: RowComment
): Promise<void> {
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
            <VersionSelector
              v-if="latestVersion"
              :versions="detail.versions"
              :selected-version-id="selectedVersionId"
              @change="handleVersionChange"
            />
            <button
              v-if="canUpload"
              type="button"
              class="upload-version-btn"
              @click="uploadOpen = true"
            >
              上传新版本
            </button>
            <span
              v-if="selectedVersion"
              class="status-badge"
              :class="isHistorical ? 'historical' : 'ready'"
            >
              {{ isHistorical ? "历史版本 · 只读" : "就绪" }}
            </span>
          </div>
        </header>

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
            :key="selectedVersion.id"
            :version-id="selectedVersion.id"
            :columns="columns"
            :row-count="selectedVersion.rowCount"
            :q="appliedQuery"
            :sort-by="sortBy"
            :sort-dir="sortDir"
            :comment-counts="commentCounts"
            :editable="canEdit"
            @sort-change="handleSortChange"
            @row-comment="handleRowComment"
          />
        </template>
      </template>
    </main>

    <FileUploadDialog
      v-if="detail"
      v-model:open="uploadOpen"
      :workspace-id="detail.file.workspaceId"
      :target-file-id="detail.file.id"
      @created="handleVersionUploaded"
      @cancelled="handleVersionUploadCancelled"
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

    <!-- KNOW -->
    <!--
    v-model:open="uploadOpen"
    =
    v-on:open="uploadOpen" 父将open传给子组件
    @update:open="uploadOpen=$event" 子通过emit触发update:open改变open的值
    -->
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

.upload-version-btn {
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

.upload-version-btn:hover {
  background: rgba(191, 161, 117, 0.15);
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
