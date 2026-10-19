// 说明：实现文件与首个版本的创建，以及工作空间下的文件列表

import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool";
import { HttpError } from "../utils/httpError";
import type { CreateFileInput, FileColumnInput } from "../utils/validate";
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

// 创建文件基本信息
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

interface FileRow extends RowDataPacket {
  id: string;
  workspace_id: string;
  name: string;
  latest_version_number: number;
  created_at: Date;
  updated_at: Date;
}

interface VersionRow extends RowDataPacket {
  id: string;
  version_number: number;
  status: string;
  columns_json: unknown;
  row_count: number;
  chunk_count: number;
  created_at: Date;
}

interface VersionSummary {
  id: string;
  versionNumber: number;
  status: string;
  columns: FileColumnInput[];
  rowCount: number;
  chunkCount: number;
  createdAt: Date;
}

interface FileDetail {
  file: {
    id: string;
    name: string;
    latestVersionNumber: number;
    createdAt: Date;
    updatedAt: Date;
  };
  latestVersion: VersionSummary | null;
  versions: VersionSummary[];
}

// mysql2可能把 JSON列解析成对象，也可能返回字符串
function parseColumns(value: unknown): FileColumnInput[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;

  if (!Array.isArray(parsed)) {
    throw new Error("版本列定义损坏");
  }

  return parsed as FileColumnInput[];
}

// 查询未删除的文件，并校验当前用户的工作空间权限
async function getAccessibleFile(
  userId: string,
  fileId: string
): Promise<FileRow> {
  const [rows] = await pool.execute<FileRow[]>(
    `SELECT id, workspace_id, name, latest_version_number,
            created_at, updated_at
     FROM files
     WHERE id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [fileId]
  );
  const file = rows[0];

  if (!file) {
    throw new HttpError(404, "文件不存在");
  }

  await assertWorkspaceAccess(userId, file.workspace_id);

  return file;
}

// 查询文件的所有版本，新版本在前
async function queryVersions(fileId: string): Promise<VersionSummary[]> {
  const [rows] = await pool.execute<VersionRow[]>(
    `SELECT id, version_number, status, columns_json, row_count,
            chunk_count, created_at
     FROM file_versions
     WHERE file_id = ?
     ORDER BY version_number DESC`,
    [fileId]
  );

  return rows.map((row) => ({
    id: row.id,
    versionNumber: row.version_number,
    status: row.status,
    columns: parseColumns(row.columns_json),
    rowCount: row.row_count,
    chunkCount: row.chunk_count,
    createdAt: row.created_at,
  }));
}

// 文件详情：文件基本信息+最新ready版本+全部版本
export async function getFileDetail(
  userId: string,
  fileId: string
): Promise<FileDetail> {
  const file = await getAccessibleFile(userId, fileId);
  const versions = await queryVersions(fileId);

  const latestVersion =
    versions.find(
      (version) =>
        version.versionNumber === file.latest_version_number &&
        version.status === "ready"
    ) ?? null;

  return {
    file: {
      id: file.id,
      name: file.name,
      latestVersionNumber: file.latest_version_number,
      createdAt: file.created_at,
      updatedAt: file.updated_at,
    },
    latestVersion,
    versions,
  };
}

// 版本列表
// oh~有点像git log的感觉
export async function listFileVersions(
  userId: string,
  fileId: string
): Promise<VersionSummary[]> {
  await getAccessibleFile(userId, fileId);

  return queryVersions(fileId);
}
