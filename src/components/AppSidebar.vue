<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useWorkspaceStore } from "@/stores/workspace";

const router = useRouter();
const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();

const showCreateForm = ref(false);
const newWorkspaceName = ref("");
const createError = ref("");

function selectWorkspace(id: string): void {
  workspaceStore.selectWorkspace(id);
  router.push(`/workspaces/${id}`);
}

// 打开创建workspace的form
function openCreateForm(): void {
  showCreateForm.value = true;
  createError.value = "";
}
// 关闭创建workspace的form
function closeCreateForm(): void {
  showCreateForm.value = false;
  newWorkspaceName.value = "";
  createError.value = "";
}
// 控制打开/关闭form
function toggleCreateForm(): void {
  if (showCreateForm.value) {
    closeCreateForm();
  } else {
    openCreateForm();
  }
}

async function handleCreate(): Promise<void> {
  const name = newWorkspaceName.value.trim();
  if (!name) {
    createError.value = "请输入工作空间名称";
    return;
  }

  createError.value = "";

  try {
    const workspace = await workspaceStore.createWorkspace(name);
    newWorkspaceName.value = "";
    showCreateForm.value = false;
    await router.push(`/workspaces/${workspace.id}`);
  } catch (err) {
    createError.value = err instanceof Error ? err.message : "创建工作空间失败";
  }
}

function handleLogout(): void {
  workspaceStore.reset();
  auth.logout();
  router.replace("/login");
}
</script>

<template>
  <aside class="app-sidebar">
    <div class="brand">Co<span>Sheet</span></div>

    <div class="sidebar-section">
      <div class="section-header">
        <span>工作空间</span>
        <button
          type="button"
          class="icon-btn"
          :title="showCreateForm ? '取消' : '新建工作空间'"
          @click="toggleCreateForm"
        >
          {{ showCreateForm ? "×" : "+" }}
        </button>
      </div>

      <form
        v-if="showCreateForm"
        class="create-form"
        @submit.prevent="handleCreate"
      >
        <input
          v-model="newWorkspaceName"
          type="text"
          maxlength="200"
          placeholder="工作空间名称"
          autofocus
        />
        <p v-if="createError" class="create-error">{{ createError }}</p>
        <div class="create-actions">
          <button
            type="button"
            class="ghost-btn"
            :disabled="workspaceStore.creating"
            @click="closeCreateForm"
          >
            取消
          </button>
          <button
            type="submit"
            class="primary-btn"
            :disabled="workspaceStore.creating"
          >
            {{ workspaceStore.creating ? "创建中..." : "创建" }}
          </button>
        </div>
      </form>

      <div class="workspace-list">
        <button
          v-for="workspace in workspaceStore.workspaces"
          :key="workspace.id"
          type="button"
          class="workspace-item"
          :class="{
            active: workspace.id === workspaceStore.currentWorkspaceId,
          }"
          :title="workspace.name"
          @click="selectWorkspace(workspace.id)"
        >
          <span class="workspace-icon">✦</span>
          <span class="workspace-name">{{ workspace.name }}</span>
        </button>

        <p
          v-if="
            !workspaceStore.loading && workspaceStore.workspaces.length === 0
          "
          class="empty-hint"
        >
          还没有工作空间
        </p>
      </div>
    </div>

    <div class="sidebar-footer">
      <div class="user-text">
        <span class="user-name">{{ auth.user?.name }}</span>
        <span class="user-email">{{ auth.user?.email }}</span>
      </div>
      <button type="button" class="logout-btn" @click="handleLogout">
        退出登录
      </button>
    </div>
  </aside>
</template>

<style scoped>
.app-sidebar {
  width: 280px;
  height: 100vh;
  box-sizing: border-box;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 28px 20px;
  background: #f9f6f1;
  border-right: 1px solid rgba(191, 161, 117, 0.15);
  color: #333;
  font-family: "PingFang SC", "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.brand {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.5px;
  text-transform: uppercase;
}

.brand span {
  color: #bfa175;
}

.sidebar-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: 36px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #8a7355;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.icon-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(191, 161, 117, 0.25);
  border-radius: 6px;
  background: transparent;
  color: #8a7355;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.2s;
}

.icon-btn:hover {
  background: rgba(191, 161, 117, 0.08);
}

.create-form {
  margin-top: 14px;
  padding: 12px;
  border: 1px solid rgba(191, 161, 117, 0.2);
  border-radius: 10px;
  background: #fff;
}

.create-form input {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 10px;
  border: 1px solid #e6e0d8;
  border-radius: 6px;
  background: #fffdf9;
  color: #333;
  font-size: 13px;
  outline: none;
}

.create-form input:focus {
  border-color: #bfa175;
  box-shadow: 0 0 0 3px rgba(191, 161, 117, 0.12);
}

.create-error {
  margin: 8px 0 0;
  color: #f56c6c;
  font-size: 12px;
  line-height: 1.5;
}

.create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.ghost-btn,
.primary-btn {
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}

.ghost-btn {
  border: 1px solid #e6e0d8;
  background: transparent;
  color: #777;
}

.primary-btn {
  border: none;
  background: #bfa175;
  color: #fff;
}

.ghost-btn:disabled,
.primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.workspace-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-top: 14px;
}

.workspace-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  padding: 11px 12px;
  margin-bottom: 6px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #777;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s;
}

.workspace-item:hover {
  background: rgba(191, 161, 117, 0.04);
  color: #333;
}

.workspace-item.active {
  border-color: rgba(191, 161, 117, 0.15);
  background: rgba(191, 161, 117, 0.1);
  color: #333;
  font-weight: 600;
}

.workspace-icon {
  flex-shrink: 0;
  color: #bfa175;
  font-size: 12px;
}

.workspace-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-hint {
  margin: 12px 2px;
  color: #aaa;
  font-size: 12px;
}

.sidebar-footer {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(191, 161, 117, 0.15);
}

.user-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
}

.user-name {
  font-size: 13px;
  font-weight: 600;
}

.user-email {
  overflow: hidden;
  color: #999;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.logout-btn {
  width: 100%;
  padding: 9px;
  border: 1px solid rgba(191, 161, 117, 0.3);
  border-radius: 8px;
  background: transparent;
  color: #8a7355;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.logout-btn:hover {
  background: rgba(191, 161, 117, 0.08);
}
</style>
