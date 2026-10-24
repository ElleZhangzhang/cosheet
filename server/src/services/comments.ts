// 说明：实现文件评论的查询、创建、解决/取消解决、删除

import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool";
import { HttpError } from "../utils/httpError";
import type { CreateCommentInput } from "../utils/validate";
import { assertWorkspaceAccess } from "./permissions";
import type { WorkspaceRole } from "./permissions";

interface Comment {
  id: string;
  versionId: string;
  rowIndex: number;
  columnKey: string | null;
  content: string;
  resolved: boolean;
  authorId: string;
  authorName: string;
  createdAt: Date;
}

interface CommentRow extends RowDataPacket {
  id: string;
  version_id: string;
  row_index: number;
  column_key: string | null;
  content: string;
  resolved: number;
  author_id: string;
  author_name: string;
  created_at: Date;
}

interface CommentContextRow extends CommentRow {
  workspace_id: string;
  deleted_at: Date | null;
}

interface FileAccessRow extends RowDataPacket {
  workspace_id: string;
}

interface VersionRow extends RowDataPacket {
  id: string;
  row_count: number;
  columns_json: unknown;
}

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    versionId: row.version_id,
    rowIndex: row.row_index,
    columnKey: row.column_key,
    content: row.content,
    resolved: Boolean(row.resolved),
    authorId: row.author_id,
    authorName: row.author_name,
    createdAt: row.created_at,
  };
}

function getColumnKeys(value: unknown): string[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;

  if (!Array.isArray(parsed)) {
    return [];
  }

  return (parsed as Array<{ keyName?: unknown }>)
    .map((column) =>
      typeof column.keyName === "string" ? column.keyName : ""
    )
    .filter(Boolean);
}

// 查询文件并校验当前用户权限
async function getFileAccess(
  userId: string,
  fileId: string,
  allowedRoles?: WorkspaceRole[]
): Promise<{ workspaceId: string; role: WorkspaceRole }> {
  const [rows] = await pool.execute<FileAccessRow[]>(
    `SELECT workspace_id FROM files
     WHERE id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [fileId]
  );
  const file = rows[0];

  if (!file) {
    throw new HttpError(404, "文件不存在");
  }

  const role = await assertWorkspaceAccess(
    userId,
    file.workspace_id,
    allowedRoles
  );

  return {
    workspaceId: file.workspace_id,
    role,
  };
}

// 版本必须属于这个文件
async function getVersionForFile(
  fileId: string,
  versionId: string
): Promise<VersionRow> {
  const [rows] = await pool.execute<VersionRow[]>(
    `SELECT id, row_count, columns_json
     FROM file_versions
     WHERE id = ? AND file_id = ?
     LIMIT 1`,
    [versionId, fileId]
  );
  const version = rows[0];

  if (!version) {
    throw new HttpError(404, "版本不存在");
  }

  return version;
}

async function getCommentById(
  commentId: string
): Promise<Comment | null> {
  const [rows] = await pool.execute<CommentRow[]>(
    `SELECT c.id, c.version_id, c.row_index, c.column_key, c.content,
            c.resolved, c.author_id, u.name AS author_name, c.created_at
     FROM comments c
     JOIN users u ON u.id = c.author_id
     WHERE c.id = ?
     LIMIT 1`,
    [commentId]
  );
  const row = rows[0];

  return row ? toComment(row) : null;
}

async function getCommentContext(
  commentId: string
): Promise<CommentContextRow> {
  const [rows] = await pool.execute<CommentContextRow[]>(
    `SELECT c.id, c.version_id, c.row_index, c.column_key, c.content,
            c.resolved, c.author_id, u.name AS author_name, c.created_at,
            f.workspace_id, f.deleted_at
     FROM comments c
     JOIN files f ON f.id = c.file_id
     JOIN users u ON u.id = c.author_id
     WHERE c.id = ?
     LIMIT 1`,
    [commentId]
  );
  const row = rows[0];

  if (!row || row.deleted_at !== null) {
    throw new HttpError(404, "评论不存在");
  }

  return row;
}

// 任意成员可以查看某个版本的评论
export async function listComments(
  userId: string,
  fileId: string,
  versionId: string
): Promise<Comment[]> {
  await getFileAccess(userId, fileId);
  await getVersionForFile(fileId, versionId);

  const [rows] = await pool.execute<CommentRow[]>(
    `SELECT c.id, c.version_id, c.row_index, c.column_key, c.content,
            c.resolved, c.author_id, u.name AS author_name, c.created_at
     FROM comments c
     JOIN users u ON u.id = c.author_id
     WHERE c.file_id = ? AND c.version_id = ?
     ORDER BY c.created_at ASC`,
    [fileId, versionId]
  );

  return rows.map(toComment);
}

// owner/editor/commenter 可以创建评论
export async function createComment(
  userId: string,
  fileId: string,
  input: CreateCommentInput
): Promise<Comment> {
  await getFileAccess(userId, fileId, [
    "owner",
    "editor",
    "commenter",
  ]);

  const version = await getVersionForFile(fileId, input.versionId);

  if (input.rowIndex >= version.row_count) {
    throw new HttpError(400, "rowIndex 超出范围");
  }

  if (input.columnKey) {
    const columnKeys = getColumnKeys(version.columns_json);
    if (!columnKeys.includes(input.columnKey)) {
      throw new HttpError(400, "columnKey 不存在");
    }
  }

  const commentId = randomUUID();

  await pool.execute(
    `INSERT INTO comments
     (id, file_id, version_id, row_index, column_key, content, resolved, author_id)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      commentId,
      fileId,
      input.versionId,
      input.rowIndex,
      input.columnKey,
      input.content,
      userId,
    ]
  );

  const comment = await getCommentById(commentId);
  if (!comment) {
    throw new Error("创建评论后查询失败");
  }

  return comment;
}

// owner/editor 可以操作任意评论；commenter 只能操作自己的
export async function updateCommentResolved(
  userId: string,
  commentId: string,
  resolved: boolean
): Promise<Comment> {
  const context = await getCommentContext(commentId);
  const role = await assertWorkspaceAccess(
    userId,
    context.workspace_id
  );

  if (role === "viewer") {
    throw new HttpError(403, "无权限执行此操作");
  }
  if (role === "commenter" && context.author_id !== userId) {
    throw new HttpError(403, "只能操作自己的评论");
  }

  await pool.execute(
    "UPDATE comments SET resolved = ? WHERE id = ?",
    [resolved ? 1 : 0, commentId]
  );

  const comment = await getCommentById(commentId);
  if (!comment) {
    throw new Error("更新评论后查询失败");
  }

  return comment;
}

// 作者或 workspace owner 可以删除
export async function deleteComment(
  userId: string,
  commentId: string
): Promise<void> {
  const context = await getCommentContext(commentId);
  const role = await assertWorkspaceAccess(
    userId,
    context.workspace_id
  );

  const isAuthor = context.author_id === userId;
  if (!isAuthor && role !== "owner") {
    throw new HttpError(403, "无权限执行此操作");
  }

  await pool.execute("DELETE FROM comments WHERE id = ?", [commentId]);
}
