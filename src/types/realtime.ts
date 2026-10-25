// 说明：WebSocket实时协同的消息与状态类型

interface RealtimeUser {
  userId: string;
  name: string;
}

interface RealtimeCell {
  rowIndex: number;
  columnKey: string;
  value: unknown;
  revision: number; // 已修改几次
  updatedAt: string;
}

interface RealtimeCellUpdate {
  cell: RealtimeCell;
  editor: RealtimeUser;
}

interface RealtimeCursor {
  user: RealtimeUser;
  rowIndex: number;
  columnKey: string | null;
}

interface ClientJoinMessage {
  type: "join";
  versionId: string;
}

interface ClientLeaveMessage {
  type: "leave";
}

interface ClientCursorMessage {
  type: "cursor";
  rowIndex: number;
  columnKey: string | null;
}

type ClientMessage =
  | ClientJoinMessage
  | ClientLeaveMessage
  | ClientCursorMessage;

interface ServerJoinedMessage {
  type: "joined";
  versionId: string;
  user: RealtimeUser;
}

interface ServerPresenceMessage {
  type: "presence";
  versionId: string;
  users: RealtimeUser[];
}

interface ServerCursorMessage {
  type: "cursor";
  versionId: string;
  user: RealtimeUser;
  rowIndex: number;
  columnKey: string | null;
}

interface ServerCellUpdateMessage {
  type: "cell:update";
  versionId: string;
  cell: RealtimeCell;
  editor: RealtimeUser;
}

interface ServerErrorMessage {
  type: "error";
  message: string;
}

type ServerMessage =
  | ServerJoinedMessage
  | ServerPresenceMessage
  | ServerCursorMessage
  | ServerCellUpdateMessage
  | ServerErrorMessage;

export type {
  RealtimeUser,
  RealtimeCell,
  RealtimeCellUpdate,
  RealtimeCursor,
  ClientMessage,
  ClientJoinMessage,
  ClientLeaveMessage,
  ClientCursorMessage,
  ServerMessage,
  ServerJoinedMessage,
  ServerPresenceMessage,
  ServerCursorMessage,
  ServerCellUpdateMessage,
  ServerErrorMessage,
};
