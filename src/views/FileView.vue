<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppSidebar from "@/components/AppSidebar.vue";
import RemoteVirtualTable from "@/components/DataTable/RemoteVirtualTable.vue";
import { getFileDetail } from "@/services/files";
import { useWorkspaceStore } from "@/stores/workspace";
import type { FileDetailResponse } from "@/types/api";

const route = useRoute();
const router = useRouter();
const workspaceStore = useWorkspaceStore();

const detail = ref<FileDetailResponse | null>(null);
const detailLoading = ref(false);
const detailError = ref("");

const searchInput = ref("");
const appliedQuery = ref("");
const sortBy = ref<string | null>(null);
const sortDir = ref<"asc" | "desc">("asc");

let searchTimer: number | undefined;

const latestVersion = computed(() => detail.value?.latestVersion ?? null);
const columns = computed(() => latestVersion.value?.columns ?? []);

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
                <template v-if="latestVersion">
                  v{{ latestVersion.versionNumber }} ·
                  {{ latestVersion.rowCount.toLocaleString() }} 行 ·
                  {{ latestVersion.columns.length }} 列 ·
                  {{ latestVersion.chunkCount }} 个分片
                </template>
                <template v-else>还没有 ready 版本</template>
              </p>
            </div>
          </div>

          <span v-if="latestVersion" class="status-badge ready"> 就绪 </span>
        </header>

        <section v-if="!latestVersion" class="status-card">
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
            :key="latestVersion.id"
            :version-id="latestVersion.id"
            :columns="columns"
            :row-count="latestVersion.rowCount"
            :q="appliedQuery"
            :sort-by="sortBy"
            :sort-dir="sortDir"
            @sort-change="handleSortChange"
          />
        </template>
      </template>
    </main>
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
