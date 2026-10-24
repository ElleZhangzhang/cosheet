<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  addMember,
  listMembers,
  removeMember,
  updateMemberRole,
} from "@/services/members";
import type {
  MemberRole,
  WorkspaceMember,
  WorkspaceRole,
} from "@/types/api";

const props = defineProps<{
  open: boolean;
  workspaceId: string;
  canManage: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const roleLabels: Record<WorkspaceRole, string> = {
  owner: "所有者",
  editor: "编辑者",
  commenter: "评论者",
  viewer: "查看者",
};

const members = ref<WorkspaceMember[]>([]);
const loading = ref(false);
const error = ref("");

const addEmail = ref("");
const addRole = ref<MemberRole>("editor");
const adding = ref(false);
const addError = ref("");

const updatingId = ref<string | null>(null);
const removingId = ref<string | null>(null);
const actionError = ref("");

const busy = computed(
  () =>
    adding.value ||
    updatingId.value !== null ||
    removingId.value !== null
);

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function resetForm(): void {
  addEmail.value = "";
  addRole.value = "editor";
  addError.value = "";
  actionError.value = "";
}

async function loadMembers(): Promise<void> {
  if (!props.workspaceId) {
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    const data = await listMembers(props.workspaceId);
    members.value = data.members;
  } catch (err) {
    error.value = getErrorMessage(err, "加载成员失败");
  } finally {
    loading.value = false;
  }
}

function closeDialog(): void {
  if (busy.value) {
    return;
  }

  emit("update:open", false);
}

async function handleAdd(): Promise<void> {
  if (!props.canManage || adding.value) {
    return;
  }

  const email = addEmail.value.trim();
  if (!email) {
    addError.value = "请输入邮箱";
    return;
  }

  adding.value = true;
  addError.value = "";

  try {
    await addMember(props.workspaceId, {
      email,
      role: addRole.value,
    });
    addEmail.value = "";
    await loadMembers();
  } catch (err) {
    addError.value = getErrorMessage(err, "添加成员失败");
  } finally {
    adding.value = false;
  }
}

async function handleRoleChange(
  member: WorkspaceMember,
  event: Event
): Promise<void> {
  if (!props.canManage || updatingId.value !== null) {
    return;
  }

  const value = (event.target as HTMLSelectElement).value;
  if (
    value !== "editor" &&
    value !== "commenter" &&
    value !== "viewer"
  ) {
    return;
  }

  if (value === member.role) {
    return;
  }

  updatingId.value = member.userId;
  actionError.value = "";

  try {
    const data = await updateMemberRole(
      props.workspaceId,
      member.userId,
      { role: value }
    );

    const index = members.value.findIndex(
      (item) => item.userId === member.userId
    );
    if (index >= 0) {
      // 用最新返回的成员覆盖当前行
      members.value.splice(index, 1, data.member);
    }
  } catch (err) {
    actionError.value = getErrorMessage(err, "修改角色失败");
    await loadMembers();
  } finally {
    updatingId.value = null;
  }
}

async function handleRemove(member: WorkspaceMember): Promise<void> {
  if (!props.canManage || removingId.value !== null) {
    return;
  }

  if (!confirm(`确定移除成员 ${member.name} 吗？`)) {
    return;
  }

  removingId.value = member.userId;
  actionError.value = "";

  try {
    await removeMember(props.workspaceId, member.userId);
    await loadMembers();
  } catch (err) {
    actionError.value = getErrorMessage(err, "移除成员失败");
  } finally {
    removingId.value = null;
  }
}

watch(
  [() => props.open, () => props.workspaceId],
  ([open]) => {
    if (open) {
      resetForm();
      void loadMembers();
    }
  },
  { immediate: true }
);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-overlay" @click.self="closeDialog">
      <div class="dialog-card">
        <header class="dialog-header">
          <div>
            <h2>成员管理</h2>
            <p>管理谁可以访问和编辑这个工作空间。</p>
          </div>
          <button
            type="button"
            class="close-btn"
            :disabled="busy"
            @click="closeDialog"
          >
            ×
          </button>
        </header>

        <div class="dialog-body">
          <form
            v-if="canManage"
            class="add-form"
            @submit.prevent="handleAdd"
          >
            <input
              v-model="addEmail"
              type="email"
              placeholder="已注册用户邮箱"
              :disabled="adding"
            />
            <select v-model="addRole" :disabled="adding">
              <option value="editor">编辑者</option>
              <option value="commenter">评论者</option>
              <option value="viewer">查看者</option>
            </select>
            <button type="submit" :disabled="adding">
              {{ adding ? "添加中..." : "添加成员" }}
            </button>
          </form>

          <p v-if="addError" class="error">{{ addError }}</p>
          <p v-if="actionError" class="error">{{ actionError }}</p>

          <div v-if="loading" class="state">正在加载成员...</div>

          <div v-else-if="error" class="state error">
            <span>{{ error }}</span>
            <button type="button" class="retry-btn" @click="loadMembers">
              重试
            </button>
          </div>

          <div v-else class="member-list">
            <article
              v-for="member in members"
              :key="member.userId"
              class="member-row"
            >
              <div class="avatar">
                {{ member.name.slice(0, 1).toUpperCase() }}
              </div>

              <div class="member-main">
                <strong>{{ member.name }}</strong>
                <span>{{ member.email }}</span>
              </div>

              <div class="member-actions">
                <template
                  v-if="canManage && member.role !== 'owner'"
                >
                  <select
                    class="role-select"
                    :value="member.role"
                    :disabled="
                      updatingId !== null || removingId !== null
                    "
                    @change="handleRoleChange(member, $event)"
                  >
                    <option value="editor">编辑者</option>
                    <option value="commenter">评论者</option>
                    <option value="viewer">查看者</option>
                  </select>
                  <button
                    type="button"
                    class="remove-btn"
                    :disabled="
                      removingId !== null || updatingId !== null
                    "
                    @click="handleRemove(member)"
                  >
                    {{
                      removingId === member.userId
                        ? "移除中..."
                        : "移除"
                    }}
                  </button>
                </template>

                <span
                  v-else
                  class="role-badge"
                  :class="member.role"
                >
                  {{ roleLabels[member.role] }}
                </span>
              </div>
            </article>

            <p v-if="members.length === 0" class="state">
              暂无成员
            </p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(40, 33, 24, 0.35);
  backdrop-filter: blur(2px);
}

.dialog-card {
  width: 100%;
  max-width: 620px;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(191, 161, 117, 0.2);
  border-radius: 16px;
  background: #fffdf9;
  box-shadow: 0 24px 60px rgba(60, 46, 27, 0.18);
  color: #333;
  font-family: "PingFang SC", "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(191, 161, 117, 0.15);
}

.dialog-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.dialog-header p {
  margin: 6px 0 0;
  color: #999;
  font-size: 12px;
}

.close-btn {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #999;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.close-btn:hover:not(:disabled) {
  background: rgba(191, 161, 117, 0.08);
  color: #555;
}

.dialog-body {
  padding: 20px 24px 24px;
  overflow-y: auto;
}

.add-form {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.add-form input,
.add-form select,
.role-select {
  box-sizing: border-box;
  padding: 9px 11px;
  border: 1px solid #e6e0d8;
  border-radius: 7px;
  background: #fff;
  color: #333;
  font-size: 12px;
  outline: none;
}

.add-form input {
  flex: 1;
  min-width: 0;
}

.add-form input:focus,
.add-form select:focus,
.role-select:focus {
  border-color: #bfa175;
  box-shadow: 0 0 0 3px rgba(191, 161, 117, 0.12);
}

.add-form button {
  padding: 9px 14px;
  border: none;
  border-radius: 7px;
  background: #bfa175;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.add-form button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error {
  margin: 0 0 14px;
  padding: 9px 12px;
  border: 1px solid rgba(245, 108, 108, 0.25);
  border-radius: 8px;
  background: #fef0f0;
  color: #f56c6c;
  font-size: 12px;
  line-height: 1.5;
}

.state {
  padding: 24px 0;
  color: #999;
  font-size: 13px;
  text-align: center;
}

.state.error {
  color: #f56c6c;
}

.retry-btn {
  margin-left: 10px;
  padding: 5px 10px;
  border: 1px solid rgba(191, 161, 117, 0.3);
  border-radius: 6px;
  background: transparent;
  color: #8a7355;
  font-size: 12px;
  cursor: pointer;
}

.member-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.member-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(191, 161, 117, 0.15);
  border-radius: 10px;
  background: #fff;
}

.avatar {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(191, 161, 117, 0.14);
  color: #8a7355;
  font-size: 13px;
  font-weight: 700;
}

.member-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.member-main strong {
  overflow: hidden;
  color: #444;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-main span {
  overflow: hidden;
  color: #999;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.role-select {
  padding: 7px 9px;
}

.remove-btn {
  padding: 7px 10px;
  border: 1px solid rgba(245, 108, 108, 0.25);
  border-radius: 7px;
  background: transparent;
  color: #f56c6c;
  font-size: 12px;
  cursor: pointer;
}

.remove-btn:hover:not(:disabled) {
  background: #fef0f0;
}

.remove-btn:disabled,
.role-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.role-badge {
  padding: 4px 10px;
  border-radius: 999px;
  background: #f4f4f5;
  color: #909399;
  font-size: 11px;
  font-weight: 600;
}

.role-badge.owner {
  background: rgba(191, 161, 117, 0.14);
  color: #8a7355;
}

.role-badge.editor {
  background: #eef5ff;
  color: #5b8ff9;
}

.role-badge.commenter {
  background: #f0f9eb;
  color: #67c23a;
}
</style>
