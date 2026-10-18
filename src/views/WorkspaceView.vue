<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppSidebar from "@/components/AppSidebar.vue";
import { useWorkspaceStore } from "@/stores/workspace";
import type { WorkspaceRole } from "@/types/api";

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

// 处理url对应的三种情况
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

async function retry(): Promise<void> {
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
        <button type="button" class="retry-btn" @click="retry">重试</button>
      </div>

      <template v-else-if="currentWorkspace">
        <header class="workspace-topbar">
          <div>
            <h1>{{ currentWorkspace.name }}</h1>
            <p class="workspace-subtitle">工作空间</p>
          </div>
          <span class="role-badge">{{ roleLabel(currentWorkspace.role) }}</span>
        </header>

        <section class="workspace-content">
          <div class="placeholder-card">
            <h2>文件与表格</h2>
            <p>文件列表、上传和远程表格将在 Phase 1 实现。</p>
          </div>
        </section>
      </template>

      <div v-else class="status-card">还没有工作空间，请在左侧新建。</div>
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
  padding: 26px 32px;
  border: 1px solid rgba(191, 161, 117, 0.15);
  border-radius: 12px;
  background: #fff;
}

.workspace-topbar h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.workspace-subtitle {
  margin: 6px 0 0;
  color: #999;
  font-size: 12px;
}

.role-badge {
  padding: 6px 12px;
  border: 1px solid rgba(191, 161, 117, 0.2);
  border-radius: 999px;
  background: rgba(191, 161, 117, 0.08);
  color: #8a7355;
  font-size: 12px;
  font-weight: 600;
}

.workspace-content {
  margin-top: 24px;
}

.placeholder-card {
  padding: 40px;
  border: 1px dashed rgba(191, 161, 117, 0.35);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.6);
}

.placeholder-card h2 {
  margin: 0 0 10px;
  font-size: 18px;
  font-weight: 600;
}

.placeholder-card p {
  margin: 0;
  color: #999;
  font-size: 14px;
}
</style>
