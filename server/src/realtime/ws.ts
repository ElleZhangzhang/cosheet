// 说明：WebSocket 实时协同：JWT 鉴权、版本房间、presence、单元格更新广播

import type { Server } from "node:http";
import type { RowDataPacket } from "mysql2";
import { WebSocket, WebSocketServer } from "ws";
import { pool } from "../db/pool";
import { getUserById } from "../services/auth";
import type { CellEdit } from "../services/cellEdits";
import { getWorkspaceRole } from "../services/permissions";
import { verifyToken } from "../utils/jwt";

interface SocketState {
  userId: string;
  userName: string;
  versionId: string | null;
}

interface VersionAccessRow extends RowDataPacket {
  workspace_id: string;
}

// key:versionId，value:所有websocket连接
const rooms = new Map<string, Set<WebSocket>>();
// 1.WeakMap的好处：socket断开销毁，浏览器自动垃圾回收，防止内存泄漏
// 2.每一个WebSocket连接对应的用户信息
const states = new WeakMap<WebSocket, SocketState>();

let wss: WebSocketServer | null = null;

// 向客户端发消息
function sendJson(ws: WebSocket, payload: unknown): void {
  // 检查连接开着，再发
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

// 大喇叭广播：向该表格房间中的所有人发消息
function broadcastRoom(
  versionId: string,
  payload: unknown,
  except?: WebSocket
): void {
  const room = rooms.get(versionId);
  if (!room) {
    return;
  }

  for (const client of room) {
    if (client !== except) {
      sendJson(client, payload);
    }
  }
}

// 盘点所有在该房间的人
function getPresence(
  versionId: string
): Array<{ userId: string; name: string }> {
  const room = rooms.get(versionId);
  if (!room) {
    return [];
  }

  const users = new Map<string, { userId: string; name: string }>();

  for (const client of room) {
    // 查看该client是否在线
    const state = states.get(client);
    if (state) {
      users.set(state.userId, {
        userId: state.userId,
        name: state.userName,
      });
    }
  }

  return Array.from(users.values());
}

// 将“在线人员名单”广播给房间里的所有人
function broadcastPresence(versionId: string): void {
  broadcastRoom(versionId, {
    type: "presence",
    versionId,
    users: getPresence(versionId),
  });
}

function leaveRoom(ws: WebSocket): void {
  const state = states.get(ws);
  if (!state?.versionId) {
    return;
  }

  const versionId = state.versionId;
  const room = rooms.get(versionId);

  // 1.销毁某用户的websocket
  room?.delete(ws);
  // 2.房间没人 → 销毁房间
  if (room && room.size === 0) {
    rooms.delete(versionId);
  }

  state.versionId = null;

  // 3.广播剩下的“在线人员名单”
  broadcastPresence(versionId);
}

// 去mysql，通过workspace查user是否有权进入version
async function canJoinVersion(
  userId: string,
  versionId: string
): Promise<boolean> {
  const [rows] = await pool.execute<VersionAccessRow[]>(
    `SELECT f.workspace_id
     FROM file_versions v
     JOIN files f ON f.id = v.file_id
     WHERE v.id = ? AND f.deleted_at IS NULL
     LIMIT 1`,
    [versionId]
  );
  const version = rows[0];

  if (!version) {
    return false;
  }

  const role = await getWorkspaceRole(userId, version.workspace_id);
  return role !== null;
}

// 处理用户加入房间的请求
async function handleJoin(
  ws: WebSocket,
  state: SocketState,
  versionId: unknown
): Promise<void> {
  // 1.查权限
  if (typeof versionId !== "string" || !versionId) {
    sendJson(ws, { type: "error", message: "缺少 versionId" });
    return;
  }

  const allowed = await canJoinVersion(state.userId, versionId);

  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  if (!allowed) {
    sendJson(ws, { type: "error", message: "无权访问该版本" });
    return;
  }

  // (1)无权离开房间
  leaveRoom(ws);
  // (2)有权进入房间
  let room = rooms.get(versionId);
  if (!room) {
    room = new Set();
    rooms.set(versionId, room);
  }
  room.add(ws);
  state.versionId = versionId;

  // a.告诉该用户假如成功
  sendJson(ws, {
    type: "joined",
    versionId,
    user: {
      userId: state.userId,
      name: state.userName,
    },
  });
  // b.更新“在线人员名单”
  broadcastPresence(versionId);
}

// 处理光标位置：用户鼠标点到了哪个格子，就把这个位置广播给房间里的其他人
function handleCursor(
  ws: WebSocket,
  state: SocketState,
  message: Record<string, unknown>
): void {
  if (!state.versionId) {
    sendJson(ws, { type: "error", message: "还没有加入版本房间" });
    return;
  }

  const rowIndex = message.rowIndex;
  if (
    typeof rowIndex !== "number" ||
    !Number.isInteger(rowIndex) ||
    rowIndex < 0
  ) {
    sendJson(ws, { type: "error", message: "rowIndex 不合法" });
    return;
  }

  const rawColumnKey = message.columnKey;
  if (
    rawColumnKey !== undefined &&
    rawColumnKey !== null &&
    typeof rawColumnKey !== "string"
  ) {
    sendJson(ws, { type: "error", message: "columnKey 不合法" });
    return;
  }

  broadcastRoom(
    state.versionId,
    {
      type: "cursor",
      versionId: state.versionId,
      user: {
        userId: state.userId,
        name: state.userName,
      },
      rowIndex,
      columnKey:
        typeof rawColumnKey === "string" ? rawColumnKey : null,
    },
    ws
  );
}

// 总调度台：处理前端发来的字符串，然后选用对应的处理函数
function handleCursorClear(
  ws: WebSocket,
  state: SocketState
): void {
  if (!state.versionId) {
    sendJson(ws, { type: "error", message: "还没有加入版本房间" });
    return;
  }

  broadcastRoom(
    state.versionId,
    {
      type: "cursor:clear",
      versionId: state.versionId,
      user: {
        userId: state.userId,
        name: state.userName,
      },
    },
    ws
  );
}

async function handleMessage(
  ws: WebSocket,
  raw: string
): Promise<void> {
  const state = states.get(ws);
  if (!state) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendJson(ws, { type: "error", message: "消息不是合法 JSON" });
    return;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    sendJson(ws, { type: "error", message: "消息格式不正确" });
    return;
  }

  const message = parsed as Record<string, unknown>;

  try {
    switch (message.type) {
      case "join":
        await handleJoin(ws, state, message.versionId);
        break;
      case "leave":
        leaveRoom(ws);
        break;
      case "cursor":
        handleCursor(ws, state, message);
        break;
      case "cursor:clear":
        handleCursorClear(ws, state);
        break;
      default:
        sendJson(ws, { type: "error", message: "未知消息类型" });
    }
  } catch {
    sendJson(ws, { type: "error", message: "服务器处理消息失败" });
  }
}

// 把WebSocket服务挂载到HTTP服务器上（路径是/ws）
export function initRealtime(server: Server): void {
  if (wss) {
    return;
  }

  wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 64 * 1024,
  });

  wss.on("connection", async (ws, req) => {
    // LIGHT 为了鉴权先暂停接收，避免客户端刚连上就发的'join'丢失
    ws.pause();

    try {
      // 1.鉴权
      const url = new URL(req.url ?? "", "http://localhost");
      const token = url.searchParams.get("token");

      if (!token) {
        ws.close(4001, "未登录");
        return;
      }

      const payload = verifyToken(token);

      // 2.去mysql查用户信息
      const user = await getUserById(payload.sub);

      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }

      states.set(ws, {
        userId: user.id,
        userName: user.name,
        versionId: null,
      });

      // 3.绑定message/close/error事件
      ws.on("message", (data) => {
        const text = Array.isArray(data)
          ? Buffer.concat(data).toString("utf8")
          : Buffer.isBuffer(data)
            ? data.toString("utf8")
            : Buffer.from(new Uint8Array(data)).toString("utf8");

        void handleMessage(ws, text);
      });

      ws.on("close", () => {
        leaveRoom(ws);
        states.delete(ws);
      });

      ws.on("error", () => {
        ws.terminate();
      });

      // 恢复接收
      ws.resume();
    } catch {
      // pause状态下close frame可能无法完成握手，先恢复再关闭
      ws.resume();
      ws.close(4001, "登录已失效");
    }
  });
}

// 向房间内所有人广播“xxx将第几行第几列改为了xxx”
export function broadcastCellUpdate(
  versionId: string,
  cell: CellEdit
): void {
  broadcastRoom(versionId, {
    type: "cell:update",
    versionId,
    cell: {
      rowIndex: cell.rowIndex,
      columnKey: cell.columnKey,
      value: cell.value,
      revision: cell.revision,
      updatedAt: cell.updatedAt,
    },
    editor: {
      userId: cell.updatedById,
      name: cell.updatedByName,
    },
  });
}
