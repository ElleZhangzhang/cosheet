import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  createWorkspace as createWorkspaceRequest,
  listWorkspaces,
} from "@/services/workspaces";
import type { Workspace } from "@/types/api";

export const useWorkspaceStore = defineStore("workspace", () => {
  const workspaces = ref<Workspace[]>([]);
  const currentWorkspaceId = ref<string | null>(null);
  const loading = ref(false);
  const creating = ref(false);
  const error = ref("");
  const loaded = ref(false);

  const currentWorkspace = computed(
    () =>
      workspaces.value.find(
        (workspace) => workspace.id === currentWorkspaceId.value
      ) ?? null
  );

  // 加载工作空间
  async function loadWorkspaces(force = false): Promise<void> {
    if (loaded.value && !force) {
      return;
    }
    if (loading.value) {
      return;
    }

    loading.value = true;
    error.value = "";

    try {
      // 请求时自动带token，后端会解析token并返回userId然后查讯用户的工作空间
      const data = await listWorkspaces();
      workspaces.value = data.workspaces;
      loaded.value = true;

      if (
        currentWorkspaceId.value &&
        !workspaces.value.some(
          (workspace) => workspace.id === currentWorkspaceId.value
        )
      ) {
        currentWorkspaceId.value = null;
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : "加载工作空间失败";
    } finally {
      loading.value = false;
    }
  }

  // 切换工作空间
  function selectWorkspace(id: string): void {
    currentWorkspaceId.value = id;
  }

  // 创建工作空间
  async function createWorkspace(name: string): Promise<Workspace> {
    creating.value = true;

    try {
      const data = await createWorkspaceRequest(name);
      workspaces.value.push(data.workspace);
      currentWorkspaceId.value = data.workspace.id;
      return data.workspace;
    } finally {
      creating.value = false;
    }
  }

  function reset(): void {
    workspaces.value = [];
    currentWorkspaceId.value = null;
    loading.value = false;
    creating.value = false;
    error.value = "";
    loaded.value = false;
  }

  return {
    workspaces,
    currentWorkspaceId,
    currentWorkspace,
    loading,
    creating,
    error,
    loaded,
    loadWorkspaces,
    selectWorkspace,
    createWorkspace,
    reset,
  };
});
