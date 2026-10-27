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

interface ClientCursorClearMessage {
  type: "cursor:clear";
}

type ClientMessage =
  | ClientJoinMessage
  | ClientLeaveMessage
  | ClientCursorMessage
  | ClientCursorClearMessage;

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

interface ServerCursorClearMessage {
  type: "cursor:clear";
  versionId: string;
  user: RealtimeUser;
}

interface RealtimeVersionCreated {
  sourceVersionId: string;
  version: {
    id: string;
    versionNumber: number;
    baseVersionId: string;
    status: "ready";
    rowCount: number;
    chunkCount: number;
  };
  file: {
    id: string;
    latestVersionNumber: number;
  };
}

interface ServerVersionCreatedMessage extends RealtimeVersionCreated {
  type: "version:created";
}

interface RealtimeCellEditsCleared {
  versionId: string;
  cleared: number;
}

interface ServerCellEditsClearedMessage
  extends RealtimeCellEditsCleared {
  type: "cells:cleared";
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
  | ServerCursorClearMessage
  | ServerVersionCreatedMessage
  | ServerCellEditsClearedMessage
  | ServerCellUpdateMessage
  | ServerErrorMessage;

export type {
  RealtimeUser,
  RealtimeCell,
  RealtimeCellUpdate,
  RealtimeCursor,
  RealtimeVersionCreated,
  RealtimeCellEditsCleared,
  ClientMessage,
  ClientJoinMessage,
  ClientLeaveMessage,
  ClientCursorMessage,
  ClientCursorClearMessage,
  ServerMessage,
  ServerJoinedMessage,
  ServerPresenceMessage,
  ServerCursorMessage,
  ServerCursorClearMessage,
  ServerVersionCreatedMessage,
  ServerCellEditsClearedMessage,
  ServerCellUpdateMessage,
  ServerErrorMessage,
};
