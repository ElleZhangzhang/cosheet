// 说明：实现文件与首个版本的创建，以及工作空间下的文件列表

import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool";
import type { CreateFileInput } from "../utils/validate";
import { assertWorkspaceAccess } from "./permissions";

interface CreatedFileVersion {
  file: {
    id: string;
    name: string;
    latestVersionNumber: number;
  };
  version: {
    id: string;
    versionNumber: number;
    status: "uploading";
    chunkCount: number;
  };
}

interface FileListRow extends RowDataPacket {
  id: string;
  name: string;
  latest_version_number: number;
  created_at: Date;
  updated_at: Date;
  version_id: string | null;
  version_number: number | null;
  row_count: number | null;
  chunk_count: number | null;
  status: string | null;
  column_count: number | null;
}

interface FileSummary {
  id: string;
  name: string;
  latestVersionNumber: number;
  createdAt: Date;
  updatedAt: Date;
  version: {
    id: string;
    versionNumber: number;
    rowCount: number;
    columnCount: number;
    chunkCount: number;
    status: string;
  } | null;
}

// 每 500 行一个 chunk
function getChunkCount(rowCount: number): number {
  return Math.ceil(rowCount / 500);
}

// 创建文件 + 第一个 uploading 版本
export async function createFileWithVersion(
  userId: string,
  workspaceId: string,
  input: CreateFileInput // 文件name/column/rowCount
): Promise<CreatedFileVersion> {
  // 断言user在workspace中的role是否能够访问workspace
  await assertWorkspaceAccess(userId, workspaceId, ["owner", "editor"]);

  const fileId = randomUUID();
  const versionId = randomUUID();
  const chunkCount = getChunkCount(input.rowCount);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // insert文件信息
    await connection.execute(
      "INSERT INTO files (id, workspace_id, name, latest_version_number, created_by_id) VALUES (?, ?, ?, 0, ?)",
      [fileId, workspaceId, input.name, userId]
    );
    // insert文件版本信息，初始版本为1
    await connection.execute(
      "INSERT INTO file_versions (id, file_id, version_number, columns_json, row_count, chunk_count, status, created_by_id) VALUES (?, ?, 1, ?, ?, ?, 'uploading', ?)",
      [
        versionId,
        fileId,
        JSON.stringify(input.columns),
        input.rowCount,
        chunkCount,
        userId,
      ]
    );

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

  return {
    file: {
      id: fileId,
      name: input.name,
      latestVersionNumber: 0,
    },
    version: {
      id: versionId,
      versionNumber: 1,
      status: "uploading",
      chunkCount,
    },
  };
}

// 查询工作空间下未删除的文件
export async function listFiles(
  userId: string,
  workspaceId: string,
  q: string
): Promise<FileSummary[]> {
  await assertWorkspaceAccess(userId, workspaceId);

  const query = q.trim();
  const params: Array<string | number> = [workspaceId];

  let sql = `
    SELECT f.id, f.name, f.latest_version_number, f.created_at, f.updated_at,
           v.id AS version_id, v.version_number, v.row_count, v.chunk_count,
           v.status, JSON_LENGTH(v.columns_json) AS column_count
    FROM files f
    LEFT JOIN file_versions v
      ON v.file_id = f.id AND v.version_number = f.latest_version_number
    WHERE f.workspace_id = ? AND f.deleted_at IS NULL
  `;

  if (query) {
    sql += " AND f.name LIKE ?";
    params.push(`%${query}%`);
  }

  sql += " ORDER BY f.updated_at DESC";

  const [rows] = await pool.execute<FileListRow[]>(sql, params);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    latestVersionNumber: row.latest_version_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version:
      row.version_id !== null &&
        row.version_number !== null &&
        row.row_count !== null &&
        row.chunk_count !== null &&
        row.status !== null &&
        row.column_count !== null
        ? {
          id: row.version_id,
          versionNumber: row.version_number,
          rowCount: row.row_count,
          columnCount: row.column_count,
          chunkCount: row.chunk_count,
          status: row.status,
        }
        : null,
  }));
}
