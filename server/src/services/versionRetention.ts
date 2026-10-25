// 说明：保留版本：源版本的基础数据（本地磁盘）+草稿（cell_edits库） = 新的ready版本

import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool";
import {
  deleteVersionChunks,
  readChunk,
  writeChunk,
} from "../storage/chunks";
import { HttpError } from "../utils/httpError";
import { assertWorkspaceAccess } from "./permissions";

const ROWS_PER_CHUNK = 500;

// 源文件信息
interface RetentionContextRow extends RowDataPacket {
  id: string;
  file_id: string;
  status: string;
  row_count: number;
  chunk_count: number;
  columns_json: unknown;
  workspace_id: string;
}

interface LockedVersionRow extends RowDataPacket {
  id: string;
  status: string;
  row_count: number;
  chunk_count: number;
  columns_json: unknown;
}

// FIND 这啥
interface FileLockRow extends RowDataPacket {
  id: string;
}

interface ChunkRow extends RowDataPacket {
  chunk_index: number;
  row_count: number;
}

interface EditRow extends RowDataPacket {
  row_index: number;
  column_key: string;
  value_json: unknown;
}

interface MaxVersionRow extends RowDataPacket {
  max_version: number;
}

// FIND 这啥
interface UploadingVersionRow extends RowDataPacket {
  id: string;
}

interface NewChunkRecord {
  index: number;
  rowCount: number;
  storageKey: string; // FIND 本地磁盘？
}

// “保留版本”（其实就是基于源版本+修改的新版本）
export interface RetainedVersion {
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

// 读取源版本上下文（锁前校验权限和状态）
// 翻译：查version户口，查它属哪个file，又属哪个workspace，...
async function getRetentionContext(
  versionId: string
): Promise<RetentionContextRow> {
  const [rows] = await pool.execute<RetentionContextRow[]>(
    `SELECT v.id, v.file_id, v.status, v.row_count, v.chunk_count,
            v.columns_json, f.workspace_id
     FROM file_versions v
     JOIN files f ON f.id = v.file_id
     WHERE v.id = ? AND f.deleted_at IS NULL
     LIMIT 1`,
    [versionId]
  );
  const context = rows[0];

  if (!context) {
    throw new HttpError(404, "版本不存在");
  }

  return context;
}

// 把草稿按rowIndex聚合，后续按chunk内的局部行号应用
function buildEditsMap(rows: EditRow[]): Map<number, Record<string, unknown>> {
  const result = new Map<number, Record<string, unknown>>();

  for (const row of rows) {
    const rowEdits = result.get(row.row_index) ?? {};
    rowEdits[row.column_key] = row.value_json;
    result.set(row.row_index, rowEdits);
  }
  // rowEdits:{
  //   column_key,
  //   value_json
  // }

  return result;
}

// 保留版本：加锁防并发 → 读取原始分片 → 覆盖修改草稿 → 写入全新分片（本地磁盘文件+mysql） → 删除旧草稿
// 中间任何一步失败，全部回滚
export async function retainVersion(
  userId: string,
  versionId: string
): Promise<RetainedVersion> {
  const context = await getRetentionContext(versionId);
  await assertWorkspaceAccess(userId, context.workspace_id, ["owner"]);

  if (context.status !== "ready") {
    throw new HttpError(409, "只能保留 ready 版本");
  }

  const connection = await pool.getConnection();
  let committed = false;
  let newVersionId = "";

  try {
    await connection.beginTransaction();

    //#region 它们三个分别的作用
    // FIND 文件行锁：防我在读的旧版本的时候文件已被别人修改
    const [fileRows] = await connection.execute<FileLockRow[]>(
      "SELECT id FROM files WHERE id = ? AND deleted_at IS NULL FOR UPDATE",
      [context.file_id]
    );
    if (!fileRows[0]) {
      throw new HttpError(404, "文件不存在");
    }

    // 锁住源版本：避免状态突变
    const [versionRows] = await connection.execute<LockedVersionRow[]>(
      `SELECT id, status, row_count, chunk_count, columns_json
       FROM file_versions
       WHERE id = ?
       FOR UPDATE`,
      [versionId]
    );
    const source = versionRows[0];

    if (!source) {
      throw new HttpError(404, "版本不存在");
    }
    if (source.status !== "ready") {
      throw new HttpError(409, "只能保留 ready 版本");
    }

    // 避免版本号冲突
    const [uploadingRows] = await connection.execute<UploadingVersionRow[]>(
      `SELECT id FROM file_versions
       WHERE file_id = ? AND status = 'uploading'
       LIMIT 1`,
      [context.file_id]
    );
    if (uploadingRows.length > 0) {
      throw new HttpError(409, "存在未完成的上传版本");
    }
    //#endregion

    const [chunkRows] = await connection.execute<ChunkRow[]>(
      `SELECT chunk_index, row_count
       FROM chunks
       WHERE version_id = ?
       ORDER BY chunk_index ASC`,
      [versionId]
    );
    if (chunkRows.length !== source.chunk_count) {
      throw new HttpError(409, "源版本分片不完整");
    }

    const [editRows] = await connection.execute<EditRow[]>(
      `SELECT row_index, column_key, value_json
       FROM cell_edits
       WHERE version_id = ?
       ORDER BY row_index ASC`,
      [versionId]
    );
    if (editRows.length === 0) {
      throw new HttpError(409, "没有可保留的修改");
    }

    const edits = buildEditsMap(editRows);

    const [maxRows] = await connection.execute<MaxVersionRow[]>(
      `SELECT COALESCE(MAX(version_number), 0) AS max_version
       FROM file_versions
       WHERE file_id = ?`,
      [context.file_id]
    );
    const versionNumber = Number(maxRows[0]?.max_version ?? 0) + 1;
    newVersionId = randomUUID();

    // 先写新版本的chunk文件；数据库记录最后统一提交
    const newChunks: NewChunkRecord[] = [];

    for (let index = 0; index < source.chunk_count; index += 1) {
      const chunk = chunkRows[index];

      //#region 检查
      if (!chunk || chunk.chunk_index !== index) {
        throw new HttpError(409, "源版本分片编号不连续");
      }

      let rows: Record<string, unknown>[];
      try {
        rows = await readChunk<Record<string, unknown>>(versionId, index);
      } catch {
        throw new HttpError(409, "源版本分片文件缺失");
      }

      if (rows.length !== chunk.row_count) {
        throw new HttpError(409, "源版本分片行数不一致");
      }
      //#endregion

      // 源版本数据+草稿
      // rows：每个chunk的所有行信息
      const mergedRows = rows.map((row, localIndex) => {
        const rowEdits = edits.get(index * ROWS_PER_CHUNK + localIndex);
        return rowEdits ? { ...row, ...rowEdits } : row;
      });

      const storageKey = await writeChunk(
        newVersionId,
        index, // row在chunk中的index
        mergedRows
      );
      newChunks.push({
        index, // chunk的index
        rowCount: mergedRows.length,
        storageKey,
      });
    }

    const columnsJson =
      typeof source.columns_json === "string"
        ? source.columns_json
        : JSON.stringify(source.columns_json);

    // 插入新版本
    await connection.execute(
      `INSERT INTO file_versions
       (id, file_id, version_number, base_version_id, columns_json,
        row_count, chunk_count, status, created_by_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
      [
        newVersionId,
        context.file_id,
        versionNumber,
        versionId,
        columnsJson,
        source.row_count,
        source.chunk_count,
        userId,
      ]
    );

    // 插入新版本的每个chunk的信息
    for (const chunk of newChunks) {
      await connection.execute(
        `INSERT INTO chunks
         (id, version_id, chunk_index, row_count, storage_key)
         VALUES (?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          newVersionId,
          chunk.index,
          chunk.rowCount,
          chunk.storageKey,
        ]
      );
    }

    await connection.execute(
      "UPDATE files SET latest_version_number = ? WHERE id = ?",
      [versionNumber, context.file_id]
    );

    // 修改已经进入新版本，源版本恢复为基础数据，但仍可继续编辑
    // 删去存储的单元格编辑数据
    await connection.execute(
      "DELETE FROM cell_edits WHERE version_id = ?",
      [versionId]
    );

    await connection.commit();
    committed = true;

    return {
      version: {
        id: newVersionId,
        versionNumber,
        baseVersionId: versionId,
        status: "ready",
        rowCount: source.row_count,
        chunkCount: source.chunk_count,
      },
      file: {
        id: context.file_id,
        latestVersionNumber: versionNumber,
      },
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // 忽略回滚失败
    }

    if (!committed && newVersionId) {
      try {
        await deleteVersionChunks(newVersionId);
      } catch {
        // 清理失败不覆盖原始错误
      }
    }

    throw error;
  } finally {
    connection.release();
  }
}
