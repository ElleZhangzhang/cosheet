// 说明：管理当前版本的 WebSocket 连接、在线用户和远程光标

import { onScopeDispose, reactive, ref, watch } from "vue";
import { createRealtimeClient } from "@/services/realtime";
import type { RealtimeClient } from "@/services/realtime";
import { useAuthStore } from "@/stores/auth";
import type {
  RealtimeCellUpdate,
  RealtimeCursor,
  RealtimeUser,
} from "@/types/realtime";

interface UseRealtimeOptions {
  onCellUpdate?: (update: RealtimeCellUpdate) => void;
}

function useRealtime(
  getVersionId: () => string | null,
  options: UseRealtimeOptions = {}
) {
  const authStore = useAuthStore();

  const connected = ref(false);
  const joined = ref(false);
  const presence = ref<RealtimeUser[]>([]);
  const cursors = reactive(new Map<string, RealtimeCursor>());
  const error = ref("");

  let client: RealtimeClient | null = null;
  // 版本切换时递增；旧连接迟到的回调不能覆盖新版本状态
  let generation = 0;

  // 切换版本/断线时reset
  function resetState(): void {
    connected.value = false;
    joined.value = false;
    presence.value = [];
    cursors.clear();
    error.value = "";
  }

  // 主动挂断
  function disconnect(): void {
    generation += 1;
    client?.close();
    client = null;
  }

  function applyPresence(users: RealtimeUser[]): void {
    // 1.同步在线名单
    presence.value = users;

    // 2.清理幽灵光标（清掉下线的人的光标）
    const activeUserIds = new Set(users.map((user) => user.userId));
    for (const userId of cursors.keys()) {
      if (!activeUserIds.has(userId)) {
        cursors.delete(userId);
      }
    }
  }

  // 发起连接
  function connect(versionId: string): void {
    // 防重复发起连接
    generation += 1;
    const currentGeneration = generation;

    client = createRealtimeClient(versionId, {
      onOpen: () => {
        if (currentGeneration !== generation) {
          return;
        }

        connected.value = true;
      },
      onJoined: (user) => {
        if (currentGeneration !== generation) {
          return;
        }

        joined.value = true;

        if (!presence.value.some((item) => item.userId === user.userId)) {
          presence.value = [...presence.value, user];
        }
      },
      onPresence: (users) => {
        if (currentGeneration !== generation) {
          return;
        }

        applyPresence(users);
      },
      onCursor: (cursor) => {
        if (currentGeneration !== generation) {
          return;
        }

        if (cursor.user.userId === authStore.user?.id) {
          return;
        }

        cursors.set(cursor.user.userId, cursor);
      },
      onCellUpdate: (update) => {
        if (currentGeneration !== generation) {
          return;
        }

        options.onCellUpdate?.(update);
      },
      onError: (message) => {
        if (currentGeneration !== generation) {
          return;
        }

        error.value = message;
      },
      onClose: (code, reason) => {
        if (currentGeneration !== generation) {
          return;
        }

        connected.value = false;
        joined.value = false;
        presence.value = [];
        cursors.clear();

        if (code === 4001) {
          error.value = "登录已失效，请重新登录";
          return;
        }

        if (code !== 1000) {
          error.value = reason || "实时连接已断开";
        }
      },
    });
  }

  function sendCursor(rowIndex: number, columnKey: string | null): void {
    client?.sendCursor(rowIndex, columnKey);
  }

  watch(
    () => getVersionId(),
    (versionId) => {
      disconnect();
      resetState();

      if (versionId) {
        connect(versionId);
      }
    },
    { immediate: true }
  );

  // 组件被销毁 → 自动断开连接，防止内存泄漏
  onScopeDispose(() => {
    disconnect();
  });

  return {
    connected,
    joined,
    presence,
    cursors,
    error,
    sendCursor,
  };
}

export { useRealtime };
export type { UseRealtimeOptions };
