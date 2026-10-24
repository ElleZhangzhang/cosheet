// 说明：工作空间成员的查询、添加、修改角色和移除

import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool";
import { HttpError } from "../utils/httpError";
import type { MemberRole } from "../utils/validate";
import { assertWorkspaceAccess } from "./permissions";
import type { WorkspaceRole } from "./permissions";

interface Member {
  userId: string;
  email: string;
  name: string;
  role: WorkspaceRole;
  joinedAt: Date;
}

interface MemberRow extends RowDataPacket {
  user_id: string;
  email: string;
  name: string;
  role: WorkspaceRole;
  created_at: Date;
}

interface UserIdRow extends RowDataPacket {
  id: string;
}

interface MembershipRow extends RowDataPacket {
  id: string;
}

interface OwnerRow extends RowDataPacket {
  owner_id: string;
}

function toMember(row: MemberRow): Member {
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    joinedAt: row.created_at,
  };
}

// 判断是否是mysql唯一键冲突
function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ER_DUP_ENTRY"
  );
}

// 查询某用户的workspace的member list（workspace是user共有的）
async function getMember(
  workspaceId: string,
  userId: string
): Promise<Member | null> {
  const [rows] = await pool.execute<MemberRow[]>(
    `SELECT u.id AS user_id, u.email, u.name, m.role, m.created_at
     FROM workspace_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = ? AND m.user_id = ?
     LIMIT 1`,
    [workspaceId, userId]
  );
  const row = rows[0];

  return row ? toMember(row) : null;
}

async function getWorkspaceOwnerId(workspaceId: string): Promise<string> {
  const [rows] = await pool.execute<OwnerRow[]>(
    "SELECT owner_id FROM workspaces WHERE id = ? LIMIT 1",
    [workspaceId]
  );
  const workspace = rows[0];

  if (!workspace) {
    throw new HttpError(404, "工作空间不存在");
  }

  return workspace.owner_id;
}

// 查询workspace的member list，任意成员都能查看成员列表
export async function listWorkspaceMembers(
  actorUserId: string,
  workspaceId: string
): Promise<Member[]> {
  await assertWorkspaceAccess(actorUserId, workspaceId);

  const [rows] = await pool.execute<MemberRow[]>(
    `SELECT u.id AS user_id, u.email, u.name, m.role, m.created_at
     FROM workspace_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = ?
     ORDER BY m.created_at ASC`,
    [workspaceId]
  );

  return rows.map(toMember);
}

// 只有 owner 能添加已注册用户
export async function addWorkspaceMember(
  actorUserId: string,
  workspaceId: string,
  email: string,
  role: MemberRole
): Promise<Member> {
  await assertWorkspaceAccess(actorUserId, workspaceId, ["owner"]);

  const [userRows] = await pool.execute<UserIdRow[]>(
    "SELECT id FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  const user = userRows[0];

  if (!user) {
    throw new HttpError(404, "用户不存在");
  }

  const [memberRows] = await pool.execute<MembershipRow[]>(
    `SELECT id FROM workspace_members
     WHERE workspace_id = ? AND user_id = ?
     LIMIT 1`,
    [workspaceId, user.id]
  );

  if (memberRows.length > 0) {
    throw new HttpError(409, "用户已经是工作空间成员");
  }

  try {
    await pool.execute(
      `INSERT INTO workspace_members (id, workspace_id, user_id, role)
       VALUES (?, ?, ?, ?)`,
      [randomUUID(), workspaceId, user.id, role]
    );
  } catch (error) {
    // LIGHT 防并发重复
    if (isDuplicateEntry(error)) {
      throw new HttpError(409, "用户已经是工作空间成员");
    }
    throw error;
  }

  const member = await getMember(workspaceId, user.id);
  if (!member) {
    throw new Error("添加成员后查询失败");
  }

  return member;
}

// 只有 owner 能修改角色，且不能修改 workspace owner
export async function updateWorkspaceMemberRole(
  actorUserId: string,
  workspaceId: string,
  targetUserId: string,
  role: MemberRole
): Promise<Member> {
  await assertWorkspaceAccess(actorUserId, workspaceId, ["owner"]);

  const ownerId = await getWorkspaceOwnerId(workspaceId);
  if (targetUserId === ownerId) {
    throw new HttpError(400, "不能修改所有者角色");
  }

  const [memberRows] = await pool.execute<MembershipRow[]>(
    `SELECT id FROM workspace_members
     WHERE workspace_id = ? AND user_id = ?
     LIMIT 1`,
    [workspaceId, targetUserId]
  );

  if (memberRows.length === 0) {
    throw new HttpError(404, "成员不存在");
  }

  await pool.execute(
    `UPDATE workspace_members
     SET role = ?
     WHERE workspace_id = ? AND user_id = ?`,
    [role, workspaceId, targetUserId]
  );

  const member = await getMember(workspaceId, targetUserId);
  if (!member) {
    throw new Error("更新成员后查询失败");
  }

  return member;
}

// 只有 owner 能移除成员，且不能移除 workspace owner
export async function removeWorkspaceMember(
  actorUserId: string,
  workspaceId: string,
  targetUserId: string
): Promise<void> {
  await assertWorkspaceAccess(actorUserId, workspaceId, ["owner"]);

  const ownerId = await getWorkspaceOwnerId(workspaceId);
  if (targetUserId === ownerId) {
    throw new HttpError(400, "不能移除所有者");
  }

  const [memberRows] = await pool.execute<MembershipRow[]>(
    `SELECT id FROM workspace_members
     WHERE workspace_id = ? AND user_id = ?
     LIMIT 1`,
    [workspaceId, targetUserId]
  );

  if (memberRows.length === 0) {
    throw new HttpError(404, "成员不存在");
  }

  await pool.execute(
    `DELETE FROM workspace_members
     WHERE workspace_id = ? AND user_id = ?`,
    [workspaceId, targetUserId]
  );
}
