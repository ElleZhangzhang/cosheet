<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppSidebar from "@/components/AppSidebar.vue";
import { getFileDetail } from "@/services/files";
import { getVersionRows } from "@/services/versions";
import { useWorkspaceStore } from "@/stores/workspace";
import type {
  FileDetailResponse,
  FileVersionDetail,
  VersionRow,
} from "@/types/api";

const route = useRoute();
const router = useRouter();
const workspaceStore = useWorkspaceStore();

const detail = ref<FileDetailResponse | null>(null);
const rows = ref<VersionRow[]>([]);
const total = ref(0);
const detailLoading = ref(false);
const rowsLoading = ref(false);
const detailError = ref("");
const rowsError = ref("");

const latestVersion = computed(() => detail.value?.latestVersion ?? null);
const columns = computed(() => latestVersion.value?.columns ?? []);

const fileId = computed(() => {
  const value = route.params.fileId;
  return typeof value === "string" ? value : "";
});

async function loadRows(version: FileVersionDetail): Promise<void> {
  rowsLoading.value = true;
  rowsError.value = "";

  try {
    const data = await getVersionRows(version.id, {
      offset: 0,
      limit: 200,
    });

    rows.value = data.rows;
    total.value = data.total;
  } catch (err) {
    rowsError.value =
      err instanceof Error ? err.message : "加载行数据失败";
  } finally {
    rowsLoading.value = false;
  }
}

async function loadFile(): Promise<void> {
  const id = fileId.value;
  if (!id) {
    return;
  }

  detailLoading.value = true;
  detailError.value = "";
  rowsError.value = "";
  detail.value = null;
  rows.value = [];
  total.value = 0;

  try {
    const data = await getFileDetail(id);
    detail.value = data;

    await workspaceStore.loadWorkspaces();
    workspaceStore.selectWorkspace(data.file.workspaceId);

    if (data.latestVersion) {
      await loadRows(data.latestVersion);
    }
  } catch (err) {
    detailError.value =
      err instanceof Error ? err.message : "加载文件失败";
  } finally {
    detailLoading.value = false;
  }
}

function reloadRows(): void {
  if (latestVersion.value) {
    void loadRows(latestVersion.value);
  }
}

function goBack(): void {
  const workspaceId =
    detail.value?.file.workspaceId ??
    workspaceStore.currentWorkspaceId;

  if (workspaceId) {
    router.push(`/workspaces/${workspaceId}`);
  } else {
    router.push("/workspaces");
  }
}

function cellText(row: VersionRow, keyName: string): string {
  const value = row[keyName];
  return value === null || value === undefined ? "" : String(value);
}

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
      <div v-if="detailLoading" class="status-card">
        正在加载文件...
      </div>

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

          <span v-if="latestVersion" class="status-badge ready">
            就绪
          </span>
        </header>

        <section v-if="!latestVersion" class="status-card">
          文件还没有完成上传，暂时不能查看表格。
        </section>

        <section v-else class="table-card">
          <div class="table-toolbar">
            <span>
              仅显示前 {{ rows.length }} 行 / 共
              {{ total.toLocaleString() }} 行
            </span>
            <span class="toolbar-note">
              搜索、排序和虚拟滚动将在下一格实现
            </span>
          </div>

          <div v-if="rowsLoading" class="status-card">
            正在加载表格数据...
          </div>

          <div v-else-if="rowsError" class="status-card error">
            <p>{{ rowsError }}</p>
            <button type="button" class="retry-btn" @click="reloadRows">
              重试
            </button>
          </div>

          <div v-else class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th class="row-index">#</th>
                  <th
                    v-for="column in columns"
                    :key="column.keyName"
                  >
                    {{ column.label }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in rows"
                  :key="row.rowIndex"
                >
                  <td class="row-index">{{ row.rowIndex + 1 }}</td>
                  <td
                    v-for="column in columns"
                    :key="column.keyName"
                    :title="cellText(row, column.keyName)"
                  >
                    {{ cellText(row, column.keyName) }}
                  </td>
                </tr>
              </tbody>
            </table>

            <p v-if="rows.length === 0" class="empty-rows">
              没有数据行
            </p>
          </div>
        </section>
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

.table-card {
  margin-top: 20px;
  overflow: hidden;
  border: 1px solid rgba(191, 161, 117, 0.15);
  border-radius: 12px;
  background: #fff;
}

.table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid rgba(191, 161, 117, 0.12);
  color: #8a7355;
  font-size: 12px;
}

.toolbar-note {
  color: #aaa;
}

.table-scroll {
  max-height: 65vh;
  overflow: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  min-width: max-content;
}

th,
td {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(191, 161, 117, 0.1);
  text-align: left;
  font-size: 13px;
  white-space: nowrap;
}

th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #faf7f2;
  color: #8a7355;
  font-size: 12px;
  font-weight: 700;
}

td {
  max-width: 320px;
  overflow: hidden;
  color: #444;
  text-overflow: ellipsis;
}

tbody tr:hover {
  background: rgba(191, 161, 117, 0.03);
}

.row-index {
  width: 56px;
  color: #bbb;
  text-align: right;
}

.empty-rows {
  margin: 0;
  padding: 32px;
  color: #aaa;
  font-size: 13px;
  text-align: center;
}
</style>
