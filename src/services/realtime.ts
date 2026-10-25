// 说明：WebSocket 客户端：连接、cs加入版本房间、sc接收消息、cs发送光标

import { getToken } from "@/utils/tokenStorage";
import type {
  ClientMessage,
  RealtimeCell,
  RealtimeCellUpdate,
  RealtimeCursor,
  RealtimeUser,
} from "@/types/realtime";

interface RealtimeHandlers {
  onOpen?: () => void;
  onJoined?: (user: RealtimeUser) => void;
  onPresence?: (users: RealtimeUser[]) => void;
  onCursor?: (cursor: RealtimeCursor) => void;
  onCellUpdate?: (update: RealtimeCellUpdate) => void;
  onError?: (message: string) => void;
  onClose?: (code: number, reason: string) => void;
}

interface RealtimeClient {
  sendCursor(rowIndex: number, columnKey: string | null): void;
  close(): void;
}

// 确定value为对象
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 校验user
function parseUser(value: unknown): RealtimeUser | null {
  if (!isRecord(value)) {
    return null;
  }

  const { userId, name } = value;
  if (typeof userId !== "string" || typeof name !== "string") {
    return null;
  }

  return { userId, name };
}

// 校验cell
function parseCell(value: unknown): RealtimeCell | null {
  if (!isRecord(value)) {
    return null;
  }

  const { rowIndex, columnKey, revision, updatedAt } = value;
  if (
    typeof rowIndex !== "number" ||
    typeof columnKey !== "string" ||
    typeof revision !== "number" ||
    typeof updatedAt !== "string"
  ) {
    return null;
  }

  return {
    rowIndex,
    columnKey,
    value: value.value,
    revision,
    updatedAt,
  };
}

// 拼接websocket地址
function buildUrl(token: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
}

// 主控台：发起连接 + 处理后端触发的事件opem/message/close + 前端接收后端消息后的处理
function createRealtimeClient(
  versionId: string,
  handlers: RealtimeHandlers = {}
): RealtimeClient {
  const token = getToken();

  if (!token) {
    handlers.onError?.("未登录");
    return {
      sendCursor: () => undefined,
      close: () => undefined,
    };
  }

  let joined = false;
  let closed = false;

  // 建立连接
  // 1.cs尝试建立连接
  const socket = new WebSocket(buildUrl(token));

  // client-server：检查连接是否正常 → 将消息转为字符串发给后端
  function send(message: ClientMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  // server-client：这个逻辑和trip-agent前端处理后端发来的answer-delta/content/error/done有异曲同工之妙
  function handleMessage(raw: string): void {
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      // KNOW catch return
      return;
    }

    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      return;
    }

    switch (parsed.type) {
      case "joined": {
        const user = parseUser(parsed.user);
        if (!user) {
          return;
        }

        joined = true;
        handlers.onJoined?.(user);
        return;
      }
      case "presence": {
        const users: RealtimeUser[] = [];

        if (Array.isArray(parsed.users)) {
          for (const item of parsed.users) {
            const user = parseUser(item);
            if (user) {
              users.push(user);
            }
          }
        }

        handlers.onPresence?.(users);
        return;
      }
      case "cursor": {
        const user = parseUser(parsed.user);
        if (!user || typeof parsed.rowIndex !== "number") {
          return;
        }

        handlers.onCursor?.({
          user,
          rowIndex: parsed.rowIndex,
          columnKey:
            typeof parsed.columnKey === "string" ? parsed.columnKey : null,
        });
        return;
      }
      case "cell:update": {
        const cell = parseCell(parsed.cell);
        const editor = parseUser(parsed.editor);
        if (!cell || !editor) {
          return;
        }

        handlers.onCellUpdate?.({ cell, editor });
        return;
      }
      case "error": {
        handlers.onError?.(
          typeof parsed.message === "string"
            ? parsed.message
            : "实时消息处理失败"
        );
        return;
      }
      default:
        return;
    }
  }

  // 2.后端同意连接，后端触发open → 前端向后端发送'join'
  socket.addEventListener("open", () => {
    handlers.onOpen?.();
    send({ type: "join", versionId });
  });

  // 后端触发message，前端通过handleMessage处理
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      handleMessage(event.data);
    }
  });

  // 后端触发close，前端通过handlers.onClose处理后续的前端内容
  socket.addEventListener("close", (event) => {
    joined = false;
    handlers.onClose?.(event.code, event.reason);
  });

  return {
    // 由前端调用，告诉后端cursor信息
    sendCursor(rowIndex, columnKey) {
      if (!joined) {
        return;
      }

      send({ type: "cursor", rowIndex, columnKey });
    },
    // 由前端调用，告诉后端leave并socket.close断开连接
    close() {
      if (closed) {
        return;
      }
      closed = true;

      if (socket.readyState === WebSocket.OPEN && joined) {
        send({ type: "leave" });
      }

      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close(1000, "离开版本");
      }
    },
  };
}

export { createRealtimeClient };
export type { RealtimeClient, RealtimeHandlers };
