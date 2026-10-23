<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "@/api/http";
import AppSidebar from "@/components/AppSidebar.vue";
import FileUploadDialog from "@/components/FileUploadDialog.vue";
import UnfinishedUploads from "@/components/UnfinishedUploads.vue";
import { listFiles } from "@/services/files";
import { cancelVersion } from "@/services/versions";
import { useWorkspaceStore } from "@/stores/workspace";
import type { FileSummary, WorkspaceRole } from "@/types/api";
import type { UploadTaskMeta } from "@/types/uploadTask";
import {
  loadUploadTaskMetas,
  removeUploadTask,
} from "@/utils/uploadTaskStorage";

const route = useRoute();
const router = useRouter();
const workspaceStore = useWorkspaceStore();

const currentWorkspace = computed(() => workspaceStore.currentWorkspace);

const roleLabels: Record<WorkspaceRole, string> = {
  owner: "所有者",
  editor: "编辑者",
  commenter: "评论者",
  viewer: "查看者",
};

function roleLabel(role: WorkspaceRole): string {
  return roleLabels[role];
}

const files = ref<FileSummary[]>([]);
const filesLoading = ref(false);
const filesError = ref("");
const searchQuery = ref("");
const uploadOpen = ref(false);
const unfinishedTasks = ref<UploadTaskMeta[]>([]);
const resumeTask = ref<UploadTaskMeta | null>(null);
const abandoningId = ref<string | null>(null);
const taskError = ref("");

let filesRequestId = 0;
let searchTimer: number | undefined;
let skipNextSearch = false;

async function loadFiles(): Promise<void> {
  // 如果用户没选任何工作区（比如刚登录进来）就不发请求，直接把文件列表清空
  const workspaceId = workspaceStore.currentWorkspaceId;
  if (!workspaceId) {
    files.value = [];
    return;
  }

  // LIGHT 防竞态请求：比如用户连续切换3个工作区
  const requestId = ++filesRequestId;

  filesLoading.value = true;
  filesError.value = "";

  try {
    const data = await listFiles(workspaceId, searchQuery.value);

    if (requestId !== filesRequestId) {
      return;
    }

    files.value = data.files;
  } catch (err) {
    if (requestId !== filesRequestId) {
      return;
    }

    filesError.value = err instanceof Error ? err.message : "加载文件失败";
  } finally {
    if (requestId === filesRequestId) {
      filesLoading.value = false;
    }
  }
}

async function handleUploaded(): Promise<void> {
  uploadOpen.value = false;
  resumeTask.value = null;
  loadUnfinishedTasks();

  if (searchQuery.value !== "") {
    // 避免：searchQuery="" → 触发watch searchQuery → 两次loadFiles
    skipNextSearch = true;
    // 避免loadFiles返回搜索后的文件们，上传后的load是不需要搜索的
    searchQuery.value = "";
  }

  await loadFiles();
}

async function handleUploadCancelled(): Promise<void> {
  uploadOpen.value = false;
  resumeTask.value = null;
  loadUnfinishedTasks();
  await loadFiles();
}

function loadUnfinishedTasks(): void {
  const workspaceId = workspaceStore.currentWorkspaceId;

  if (!workspaceId) {
    unfinishedTasks.value = [];
    return;
  }

  unfinishedTasks.value = loadUploadTaskMetas().filter(
    (task) => task.workspaceId === workspaceId
  );
}

function openNewUpload(): void {
  taskError.value = "";
  resumeTask.value = null;
  uploadOpen.value = true;
}

function handleResume(task: UploadTaskMeta): void {
  taskError.value = "";
  resumeTask.value = task;
  uploadOpen.value = true;
}

function openFile(file: FileSummary): void {
  if (file.version?.status !== "ready") {
    return;
  }

  router.push(`/files/${file.id}`);
}

async function handleAbandon(task: UploadTaskMeta): Promise<void> {
  if (abandoningId.value) {
    return;
  }

  abandoningId.value = task.versionId;
  taskError.value = "";

  try {
    try {
      await cancelVersion(task.versionId);
    } catch (err) {
      // 版本已经不存在或已经完成，也允许清理本地任务
      if (
        !(
          err instanceof ApiError &&
          (err.status === 404 || err.status === 409)
        )
      ) {
        throw err;
      }
    }

    await removeUploadTask(task.versionId);

    if (resumeTask.value?.versionId === task.versionId) {
      resumeTask.value = null;
      uploadOpen.value = false;
    }

    await loadFiles();
  } catch (err) {
    taskError.value =
      err instanceof Error ? err.message : "放弃上传失败";
  } finally {
    loadUnfinishedTasks();
    abandoningId.value = null;
  }
}

watch(uploadOpen, (open) => {
  if (open) {
    return;
  }

  resumeTask.value = null;
  loadUnfinishedTasks();
  void loadFiles();
});

function formatTime(value: string): string {
  const date = new Date(value);
  // 1.date.getTime：返回从1970年1月1日到现在的毫秒数（时间戳）
  // 2.date.toLocaleString：把时间对象转成本地时区的易读字符串
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

// watch currentWorkspaceId/searchQuery → loadFiles()
// BUG讲述
watch(
  () => workspaceStore.currentWorkspaceId,
  (workspaceId) => {
    if (searchTimer !== undefined) {
      window.clearTimeout(searchTimer);
      searchTimer = undefined;
    }

    if (searchQuery.value !== "") {
      skipNextSearch = true;
      searchQuery.value = "";
    }

    resumeTask.value = null;
    taskError.value = "";
    loadUnfinishedTasks();

    if (workspaceId) {
      void loadFiles();
    } else {
      files.value = [];
    }
  },
  { immediate: true }
);

watch(searchQuery, () => {
  if (skipNextSearch) {
    skipNextSearch = false;
    return;
  }

  if (!workspaceStore.currentWorkspaceId) {
    return;
  }

  if (searchTimer !== undefined) {
    window.clearTimeout(searchTimer);
  }

  searchTimer = window.setTimeout(() => {
    void loadFiles();
  }, 300);
});

onBeforeUnmount(() => {
  if (searchTimer !== undefined) {
    window.clearTimeout(searchTimer);
  }
});

// 处理url对应的三种情况 → 获取workspace
async function syncRoute(): Promise<void> {
  await workspaceStore.loadWorkspaces();

  if (workspaceStore.error) {
    return;
  }

  const workspaceId = route.params.workspaceId;

  // url带workspace
  if (typeof workspaceId === "string") {
    const exists = workspaceStore.workspaces.some(
      (workspace) => workspace.id === workspaceId
    );

    // 1.不存在 → 打回默认渲染
    if (!exists) {
      await router.replace("/workspaces");
      return;
    }

    // 2.存在该空间 → 渲染它
    workspaceStore.selectWorkspace(workspaceId);
    return;
  }

  // 3.url不带workspace → 取第一个workspace渲染
  const firstWorkspace = workspaceStore.workspaces[0];
  if (firstWorkspace) {
    await router.replace(`/workspaces/${firstWorkspace.id}`);
  }
}

async function retryWorkspaces(): Promise<void> {
  await workspaceStore.loadWorkspaces(true);
  await syncRoute();
}

onMounted(() => {
  void syncRoute();
});

watch(
  () => route.params.workspaceId,
  () => {
    void syncRoute();
  }
);
</script>

<template>
  <div class="workspace-layout">
    <AppSidebar />

    <main class="workspace-main">
      <div v-if="workspaceStore.loading" class="status-card">
        正在加载工作空间...
      </div>

      <div v-else-if="workspaceStore.error" class="status-card error">
        <p>{{ workspaceStore.error }}</p>
        <button type="button" class="retry-btn" @click="retryWorkspaces">
          重试
        </button>
      </div>

      <template v-else-if="currentWorkspace">
        <header class="workspace-topbar">
          <div class="title-group">
            <h1>{{ currentWorkspace.name }}</h1>
            <span class="role-badge">
              {{ roleLabel(currentWorkspace.role) }}
            </span>
          </div>

          <div class="topbar-actions">
            <input
              v-model="searchQuery"
              class="search-input"
              type="search"
              placeholder="搜索文件名"
            />
            <button type="button" class="upload-btn" @click="openNewUpload">
              上传文件
            </button>
          </div>
        </header>

        <UnfinishedUploads
          :tasks="unfinishedTasks"
          :abandoning-id="abandoningId"
          @resume="handleResume"
          @abandon="handleAbandon"
        />

        <p v-if="taskError" class="task-error">{{ taskError }}</p>

        <section class="workspace-content">
          <div class="content-heading">
            <h2>文件</h2>
            <span class="file-count">{{ files.length }} 个</span>
          </div>

          <div v-if="filesLoading" class="status-card">正在加载文件...</div>

          <div v-else-if="filesError" class="status-card error">
            <p>{{ filesError }}</p>
            <button type="button" class="retry-btn" @click="loadFiles()">
              重试
            </button>
          </div>

          <div v-else-if="files.length === 0" class="empty-card">
            <h3>还没有文件</h3>
            <p>上传 Excel 或 CSV 文件开始使用。</p>
            <button type="button" class="upload-btn" @click="openNewUpload">
              上传文件
            </button>
          </div>

          <div v-else class="file-list">
            <article
              v-for="file in files"
              :key="file.id"
              class="file-row"
              :class="{
                clickable: file.version?.status === 'ready',
              }"
              :role="file.version?.status === 'ready' ? 'button' : undefined"
              :tabindex="file.version?.status === 'ready' ? 0 : undefined"
              @click="openFile(file)"
              @keydown.enter="openFile(file)"
            >
              <div class="file-icon">▤</div>

              <div class="file-main">
                <div class="file-name-row">
                  <h3>{{ file.name }}</h3>
                  <span
                    class="status-badge"
                    :class="file.version?.status ?? 'uploading'"
                  >
                    {{ file.version?.status === "ready" ? "就绪" : "上传中" }}
                  </span>
                </div>
                <p class="file-meta">
                  <template v-if="file.version">
                    {{ file.version.rowCount.toLocaleString() }} 行 ·
                    {{ file.version.columnCount }} 列 · v{{
                      file.version.versionNumber
                    }}
                  </template>
                  <template v-else>等待上传完成</template>
                </p>
              </div>

              <span class="file-time">
                {{ formatTime(file.updatedAt) }}
              </span>
            </article>
          </div>
        </section>
      </template>

      <div v-else class="status-card">还没有工作空间，请在左侧新建。</div>
    </main>

    <!-- 上传文件的弹窗 -->
    <FileUploadDialog
      v-if="currentWorkspace"
      v-model:open="uploadOpen"
      :workspace-id="currentWorkspace.id"
      :resume-task="resumeTask"
      @created="handleUploaded"
      @cancelled="handleUploadCancelled"
    />
    <!-- created何时触发？子组件emit时 -->
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

.workspace-main {
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

.retry-btn {
  padding: 7px 14px;
  border: 1px solid rgba(191, 161, 117, 0.3);
  border-radius: 6px;
  background: transparent;
  color: #8a7355;
  font-size: 13px;
  cursor: pointer;
}

.workspace-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 24px 32px;
  border: 1px solid rgba(191, 161, 117, 0.15);
  border-radius: 12px;
  background: #fff;
}

.title-group {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.title-group h1 {
  margin: 0;
  overflow: hidden;
  font-size: 24px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-badge {
  flex-shrink: 0;
  padding: 6px 12px;
  border: 1px solid rgba(191, 161, 117, 0.2);
  border-radius: 999px;
  background: rgba(191, 161, 117, 0.08);
  color: #8a7355;
  font-size: 12px;
  font-weight: 600;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.search-input {
  width: 220px;
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

.upload-btn {
  padding: 9px 18px;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #bfa175 0%, #d8b08a 100%);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.upload-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(191, 161, 117, 0.25);
}

.task-error {
  margin: 12px 0 0;
  padding: 10px 14px;
  border: 1px solid rgba(245, 108, 108, 0.25);
  border-radius: 8px;
  background: #fef0f0;
  color: #f56c6c;
  font-size: 13px;
}

.workspace-content {
  margin-top: 24px;
}

.content-heading {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
  padding: 0 4px;
}

.content-heading h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.file-count {
  color: #999;
  font-size: 12px;
}

.empty-card {
  padding: 56px 32px;
  border: 1px dashed rgba(191, 161, 117, 0.35);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.6);
  text-align: center;
}

.empty-card h3 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
}

.empty-card p {
  margin: 0 0 20px;
  color: #999;
  font-size: 14px;
}

.file-list {
  overflow: hidden;
  border: 1px solid rgba(191, 161, 117, 0.15);
  border-radius: 12px;
  background: #fff;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 22px;
  border-bottom: 1px solid rgba(191, 161, 117, 0.1);
  transition: background-color 0.2s;
}

.file-row:last-child {
  border-bottom: none;
}

.file-row:hover {
  background: rgba(191, 161, 117, 0.03);
}

.file-row.clickable {
  cursor: pointer;
}

.file-icon {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(191, 161, 117, 0.1);
  color: #bfa175;
  font-size: 18px;
}

.file-main {
  flex: 1;
  min-width: 0;
}

.file-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.file-name-row h3 {
  margin: 0;
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badge {
  flex-shrink: 0;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.status-badge.ready {
  background: #f0f9eb;
  color: #67c23a;
}

.status-badge.uploading {
  background: rgba(191, 161, 117, 0.12);
  color: #8a7355;
}

.file-meta {
  margin: 6px 0 0;
  color: #999;
  font-size: 12px;
}

.file-time {
  flex-shrink: 0;
  color: #aaa;
  font-size: 12px;
}
</style>
