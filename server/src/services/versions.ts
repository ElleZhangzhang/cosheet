// 说明：实现分片上传、完成版本和取消上传中的版本

import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool";
import {
  chunkFileExists,
  deleteVersionChunks,
  writeChunk,
} from "../storage/chunks";
import { HttpError } from "../utils/httpError";
import { assertWorkspaceAccess } from "./permissions";

interface VersionContextRow extends RowDataPacket {
  id: string;
  file_id: string;
  version_number: number;
  row_count: number;
  chunk_count: number;
  status: string;
  workspace_id: string;
}

interface ChunkStatsRow extends RowDataPacket {
  count: number;
  total: number;
}

interface ChunkIndexRow extends RowDataPacket {
  chunk_index: number;
  row_count: number;
}

interface UploadedChunk {
  index: number;
  rowCount: number;
}

interface VersionChunksResult {
  versionId: string;
  fileId: string;
  status: "uploading";
  rowCount: number;
  chunkCount: number;
  chunks: UploadedChunk[];
}

interface CompleteResult {
  version: {
    id: string;
    versionNumber: number;
    status: "ready";
    rowCount: number;
    chunkCount: number;
  };
  file: {
    id: string;
    latestVersionNumber: number;
  };
}

// 查询版本及其所属文件、工作空间
async function getVersionContext(
  versionId: string
): Promise<VersionContextRow> {
  const [rows] = await pool.execute<VersionContextRow[]>(
    `SELECT v.id, v.file_id, v.version_number, v.row_count, v.chunk_count,
            v.status, f.workspace_id
     FROM file_versions v
     JOIN files f ON f.id = v.file_id
     WHERE v.id = ? AND f.deleted_at IS NULL
     LIMIT 1`,
    [versionId]
  );
  const version = rows[0];

  if (!version) {
    throw new HttpError(404, "版本不存在");
  }

  return version;
}

// 查询 uploading 版本已经上传的分片，供断点续传使用
export async function listUploadedChunks(
  userId: string,
  versionId: string
): Promise<VersionChunksResult> {
  const version = await getVersionContext(versionId);
  await assertWorkspaceAccess(userId, version.workspace_id, [
    "owner",
    "editor",
  ]);

  if (version.status !== "uploading") {
    throw new HttpError(409, "版本已完成上传，不能续传");
  }

  const [rows] = await pool.execute<ChunkIndexRow[]>(
    `SELECT chunk_index, row_count
     FROM chunks
     WHERE version_id = ?
     ORDER BY chunk_index ASC`,
    [versionId]
  );

  // 数据库有记录还不够，必须确认磁盘文件也存在
  const checked = await Promise.all(
    rows.map(async (row) => ({
      index: row.chunk_index,
      rowCount: row.row_count,
      exists: await chunkFileExists(versionId, row.chunk_index),
    }))
  );

  return {
    versionId: version.id,
    fileId: version.file_id,
    status: "uploading",
    rowCount: version.row_count,
    chunkCount: version.chunk_count,
    chunks: checked
      .filter((chunk) => chunk.exists)
      .map((chunk) => ({
        index: chunk.index,
        rowCount: chunk.rowCount,
      })),
  };
}

// 上传单个分片；同一index重传时覆盖
export async function uploadChunk(
  userId: string,
  versionId: string,
  index: number,
  rows: Record<string, unknown>[]
): Promise<{ index: number; rowCount: number }> {
  const version = await getVersionContext(versionId);
  await assertWorkspaceAccess(userId, version.workspace_id, [
    "owner",
    "editor",
  ]);

  if (version.status !== "uploading") {
    throw new HttpError(409, "版本不可上传");
  }
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= version.chunk_count
  ) {
    throw new HttpError(400, "分片索引不合法");
  }
  if (rows.length === 0 || rows.length > 500) {
    throw new HttpError(400, "分片行数必须为 1–500");
  }

  // 数据写入磁盘
  const storageKey = await writeChunk(versionId, index, rows);
  // 分片信息写入数据库
  await pool.execute(
    `INSERT INTO chunks (id, version_id, chunk_index, row_count, storage_key)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       row_count = VALUES(row_count),
       storage_key = VALUES(storage_key)`,
    [randomUUID(), versionId, index, rows.length, storageKey]
  );

  return { index, rowCount: rows.length };
}

// 大文件分片上传完成后的收尾校验与状态更新：把版本置为 ready，并更新文件最新版本号
// FIND 要是校验出错误，是否改delete所有文件分片数据，由后端直接做还是先告诉前端让用户决定？
export async function completeVersion(
  userId: string,
  versionId: string,
  input: { rowCount: number; chunkCount: number }
): Promise<CompleteResult> {
  const version = await getVersionContext(versionId);
  await assertWorkspaceAccess(userId, version.workspace_id, [
    "owner",
    "editor",
  ]);

  if (version.status !== "uploading") {
    throw new HttpError(409, "版本不可完成");
  }
  if (
    input.rowCount !== version.row_count ||
    input.chunkCount !== version.chunk_count
  ) {
    throw new HttpError(400, "rowCount/chunkCount 与版本不一致");
  }
  if (input.chunkCount !== Math.ceil(input.rowCount / 500)) {
    throw new HttpError(400, "chunkCount 与 rowCount 不匹配");
  }

  const [statsRows] = await pool.execute<ChunkStatsRow[]>(
    `SELECT COUNT(*) AS count,
            CAST(COALESCE(SUM(row_count), 0) AS SIGNED) AS total
     FROM chunks
     WHERE version_id = ?`,
    [versionId]
  );
  const stats = statsRows[0];

  if (
    !stats ||
    stats.count !== version.chunk_count ||
    stats.total !== version.row_count
  ) {
    throw new HttpError(409, "分片不完整");
  }

  const fileChecks = await Promise.all(
    Array.from({ length: version.chunk_count }, (_, index) =>
      chunkFileExists(versionId, index)
    )
  );
  if (fileChecks.some((exists) => !exists)) {
    throw new HttpError(409, "分片文件缺失");
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute(
      "UPDATE file_versions SET status = 'ready' WHERE id = ?",
      [versionId]
    );
    await connection.execute(
      "UPDATE files SET latest_version_number = ? WHERE id = ?",
      [version.version_number, version.file_id]
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
    version: {
      id: version.id,
      versionNumber: version.version_number,
      status: "ready",
      rowCount: version.row_count,
      chunkCount: version.chunk_count,
    },
    file: {
      id: version.file_id,
      latestVersionNumber: version.version_number,
    },
  };
}

// 取消上传中的版本：先删磁盘文件，再删数据库记录
export async function cancelVersion(
  userId: string,
  versionId: string
): Promise<void> {
  const version = await getVersionContext(versionId);
  await assertWorkspaceAccess(userId, version.workspace_id, [
    "owner",
    "editor",
  ]);

  if (version.status !== "uploading") {
    throw new HttpError(409, "只能取消上传中的版本");
  }

  // 删磁盘文件
  await deleteVersionChunks(versionId);
  // 删数据库记录
  await pool.execute("DELETE FROM file_versions WHERE id = ?", [versionId]);
}
