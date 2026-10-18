// 说明：实现工作空间的查询与创建

import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool";

type WorkspaceRole = "owner" | "editor" | "commenter" | "viewer";

interface Workspace {
  id: string;
  name: string;
  role: WorkspaceRole;
  createdAt: Date;
}

// 列表查询：workspaces和workspace_members联表：role来自成员表
interface WorkspaceListRow extends RowDataPacket {
  id: string;
  name: string;
  role: WorkspaceRole;
  created_at: Date;
}

// 创建后查询：workspace 本身没有 role 字段
interface WorkspaceRow extends RowDataPacket {
  id: string;
  name: string;
  created_at: Date;
}

// 查询当前用户参与的所有工作空间
export async function listWorkspaces(userId: string): Promise<Workspace[]> {
  const [rows] = await pool.execute<WorkspaceListRow[]>(
    `SELECT w.id, w.name, m.role, w.created_at
     FROM workspaces w
     JOIN workspace_members m ON m.workspace_id = w.id
     WHERE m.user_id = ?
     ORDER BY w.created_at ASC`,
    [userId]
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
  }));
}

// 在调用方的事务中插入工作空间和 owner 成员；不负责 commit/rollback
export async function insertWorkspaceWithOwner(
  connection: PoolConnection,
  userId: string,
  name: string
): Promise<string> {
  const workspaceId = randomUUID();
  const memberId = randomUUID();

  await connection.execute(
    "INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)",
    [workspaceId, name, userId]
  );
  await connection.execute(
    "INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)",
    [memberId, workspaceId, userId, "owner"]
  );

  return workspaceId;
}

// 创建工作空间：工作空间和owner成员必须一起成功或一起失败
export async function createWorkspace(
  userId: string,
  name: string
): Promise<Workspace> {
  const connection = await pool.getConnection();
  let workspaceId = "";

  try {
    await connection.beginTransaction();
    workspaceId = await insertWorkspaceWithOwner(connection, userId, name);
    await connection.commit();
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // 忽略回滚失败，保留原始错误
    }

    throw error;
  } finally {
    connection.release();
  }

  return getWorkspaceById(workspaceId);
}

async function getWorkspaceById(workspaceId: string): Promise<Workspace> {
  const [rows] = await pool.execute<WorkspaceRow[]>(
    "SELECT id, name, created_at FROM workspaces WHERE id = ? LIMIT 1",
    [workspaceId]
  );
  const workspace = rows[0];

  if (!workspace) {
    throw new Error("工作空间创建后查询失败");
  }

  return {
    id: workspace.id,
    name: workspace.name,
    role: "owner",
    createdAt: workspace.created_at,
  };
}
