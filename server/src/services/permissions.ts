// 说明：工作空间权限校验，供文件、上传、评论等模块复用

import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool";
import { HttpError } from "../utils/httpError";

export type WorkspaceRole = "owner" | "editor" | "commenter" | "viewer";

interface RoleRow extends RowDataPacket {
  role: WorkspaceRole;
}

// 查询用户在工作空间中的角色，不是成员则返回 null
export async function getWorkspaceRole(
  userId: string,
  workspaceId: string
): Promise<WorkspaceRole | null> {
  const [rows] = await pool.execute<RoleRow[]>(
    "SELECT role FROM workspace_members WHERE user_id = ? AND workspace_id = ? LIMIT 1",
    [userId, workspaceId]
  );

  return rows[0]?.role ?? null;
}

// 校验工作空间访问权限；allowedRoles 为空表示任意成员
export async function assertWorkspaceAccess(
  userId: string,
  workspaceId: string,
  allowedRoles?: WorkspaceRole[]
): Promise<WorkspaceRole> {
  const role = await getWorkspaceRole(userId, workspaceId);

  if (!role) {
    // 不用 403，避免暴露工作空间是否存在
    throw new HttpError(404, "工作空间不存在或无权访问");
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    throw new HttpError(403, "无权限执行此操作");
  }

  return role;
}
