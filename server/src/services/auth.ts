// 说明：实现用户点击 “注册”/“登录”按钮后的对应动作：数据库校验 + 注册后给用户创建user_id/workspace_id/member_id（role为owner）

import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool";
import { HttpError } from "../utils/httpError";
import { hashPassword, verifyPassword } from "../utils/password";

interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

interface IdRow extends RowDataPacket {
  id: string;
}

interface UserRow extends RowDataPacket {
  id: string;
  email: string;
  name: string;
  created_at: Date;
  password_hash?: string;
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
  };
}

// mysql执行语句出现问题（MySQL端的问题）
function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ER_DUP_ENTRY"
  );
  // ER_DUP_ENTRY：MySQL官方的错误代码，代表“唯一索引冲突”（UNIQUE KEY）
}

export async function registerUser(
  email: string,
  password: string,
  name: string
): Promise<PublicUser> {

  // LIGHT 防止并发冲突
  // 1. 先select一次，拦截重复注册的情况
  const [existing] = await pool.execute<IdRow[]>(
    "SELECT id FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  if (existing.length > 0) {
    throw new HttpError(409, "邮箱已注册");
  }

  const passwordHash = await hashPassword(password);
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const memberId = randomUUID();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute(
      "INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)",
      [userId, email, passwordHash, name]
    );
    await connection.execute(
      "INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)",
      [workspaceId, `${name} 的工作空间`, userId]
    );
    await connection.execute(
      "INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)",
      [memberId, workspaceId, userId, "owner"]
    );

    await connection.commit();
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // 忽略回滚失败，保留原始错误防止“回滚失败”的错误覆盖掉“连接断开”等错误
      // 问题：回滚失败咋办？数据在数据库中成垃圾数据了？不用担心，MySQL 检测到客户端断开，会自动把未提交的事务）全部回滚。
    }

    // 2.再通过mysql返回的错误避免并发冲突的情况
    if (isDuplicateEntry(error)) {
      throw new HttpError(409, "邮箱已注册");
    }
    throw error;
  } finally {
    connection.release();
  }

  return getUserById(userId);
}

export async function loginUser(
  email: string,
  password: string
): Promise<PublicUser> {
  const [rows] = await pool.execute<UserRow[]>(
    "SELECT id, email, name, created_at, password_hash FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  const user = rows[0];

  // 别换成“邮箱错误或不存在”，不然黑客就知道：欧~原来这个用户是存在的啊
  if (!user?.password_hash) {
    throw new HttpError(401, "邮箱或密码错误");
  }

  const passwordMatches = await verifyPassword(password, user.password_hash);
  if (!passwordMatches) {
    throw new HttpError(401, "邮箱或密码错误");
  }

  return toPublicUser(user);
}

export async function getUserById(id: string): Promise<PublicUser> {
  const [rows] = await pool.execute<UserRow[]>(
    "SELECT id, email, name, created_at FROM users WHERE id = ? LIMIT 1",
    [id]
  );
  const user = rows[0];

  if (!user) {
    throw new HttpError(401, "用户不存在");
  }

  return toPublicUser(user);
}
