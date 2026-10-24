// 说明：单元格编辑覆盖层。基础chunk rows保持只读，编辑写入cell_edits。

import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool";
import { HttpError } from "../utils/httpError";
import type { FileColumnInput } from "../utils/validate";
import { assertWorkspaceAccess } from "./permissions";

interface VersionEditContextRow extends RowDataPacket {
  id: string;
  version_number: number;
  status: string;
  row_count: number;
  columns_json: unknown;
  latest_version_number: number;
  workspace_id: string;
}

interface CellEditValueRow extends RowDataPacket {
  row_index: number;
  column_key: string;
  value_json: unknown;
}

interface CellEditRow extends CellEditValueRow {
  revision: number; // 单元格的修改次数
  updated_by_id: string;
  updated_by_name: string;
  updated_at: Date;
}

export interface CellEdit {
  rowIndex: number;
  columnKey: string;
  value: unknown;
  revision: number;
  updatedById: string;
  updatedByName: string;
  updatedAt: Date;
}

export type CellEditsMap = Map<number, Record<string, unknown>>;

function parseColumns(value: unknown): FileColumnInput[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;

  if (!Array.isArray(parsed)) {
    throw new Error("版本列定义损坏");
  }

  return parsed as FileColumnInput[];
}

function toEditsMap(rows: CellEditValueRow[]): CellEditsMap {
  const result: CellEditsMap = new Map();

  for (const row of rows) {
    const rowEdits = result.get(row.row_index) ?? {};
    rowEdits[row.column_key] = row.value_json;
    result.set(row.row_index, rowEdits);
  }

  return result;
}

// 查询某个版本指定行范围内的编辑
export async function getCellEditsInRange(
  versionId: string,
  startRow: number,
  endRow: number
): Promise<CellEditsMap> {
  if (endRow < startRow) {
    return new Map();
  }

  const [rows] = await pool.execute<CellEditValueRow[]>(
    `SELECT row_index, column_key, value_json
     FROM cell_edits
     WHERE version_id = ? AND row_index BETWEEN ? AND ?
     ORDER BY row_index ASC`,
    [versionId, startRow, endRow]
  );

  return toEditsMap(rows);
}

// 获取所有单元格编辑
export async function getAllCellEdits(
  versionId: string
): Promise<CellEditsMap> {
  const [rows] = await pool.execute<CellEditValueRow[]>(
    `SELECT row_index, column_key, value_json
     FROM cell_edits
     WHERE version_id = ?
     ORDER BY row_index ASC`,
    [versionId]
  );

  return toEditsMap(rows);
}

// 将value转换为对应类型
function normalizeCellValue(
  value: unknown,
  type: FileColumnInput["type"] // number/date/string
): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  if (type === "number") {
    if (typeof value !== "number" && typeof value !== "string") {
      throw new HttpError(400, "该列只接受数字");
    }

    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new HttpError(400, "该列只接受数字");
    }

    return number;
  }

  if (type === "date") {
    if (typeof value !== "string") {
      throw new HttpError(400, "该列只接受日期字符串");
    }

    const time = Date.parse(value);
    if (Number.isNaN(time)) {
      throw new HttpError(400, "日期格式不正确");
    }

    return value.trim();
  }

  if (typeof value === "object") {
    throw new HttpError(400, "该列只接受字符串");
  }

  return String(value);
}

// 编辑最新ready版本的单个单元格
export async function upsertCellEdit(
  userId: string,
  versionId: string,
  rowIndex: number,
  columnKey: string,
  value: unknown
): Promise<CellEdit> {
  const [versions] = await pool.execute<VersionEditContextRow[]>(
    `SELECT v.id, v.version_number, v.status, v.row_count, v.columns_json,
            f.latest_version_number, f.workspace_id
     FROM file_versions v
     JOIN files f ON f.id = v.file_id
     WHERE v.id = ? AND f.deleted_at IS NULL
     LIMIT 1`,
    [versionId]
  );
  const version = versions[0];

  if (!version) {
    throw new HttpError(404, "版本不存在");
  }

  await assertWorkspaceAccess(userId, version.workspace_id, [
    "owner",
    "editor",
  ]);

  if (version.status !== "ready") {
    throw new HttpError(409, "版本尚未完成上传");
  }
  if (version.version_number !== version.latest_version_number) {
    throw new HttpError(409, "只能编辑最新 ready 版本");
  }
  if (
    !Number.isInteger(rowIndex) ||
    rowIndex < 0 ||
    rowIndex >= version.row_count
  ) {
    throw new HttpError(400, "行索引超出范围");
  }

  const columns = parseColumns(version.columns_json);
  const column = columns.find((item) => item.keyName === columnKey);
  if (!column) {
    throw new HttpError(400, "列不存在");
  }

  const normalizedValue = normalizeCellValue(value, column.type);

  await pool.execute(
    `INSERT INTO cell_edits
     (id, version_id, row_index, column_key, value_json, revision, updated_by_id)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       value_json = VALUES(value_json),
       revision = revision + 1,
       updated_by_id = VALUES(updated_by_id),
       updated_at = CURRENT_TIMESTAMP(3)`,
    [
      randomUUID(),
      versionId,
      rowIndex,
      columnKey,
      JSON.stringify(normalizedValue),
      userId,
    ]
  );

  const [rows] = await pool.execute<CellEditRow[]>(
    `SELECT e.row_index, e.column_key, e.value_json, e.revision,
            e.updated_by_id, u.name AS updated_by_name, e.updated_at
     FROM cell_edits e
     JOIN users u ON u.id = e.updated_by_id
     WHERE e.version_id = ? AND e.row_index = ? AND e.column_key = ?
     LIMIT 1`,
    [versionId, rowIndex, columnKey]
  );
  const edit = rows[0];

  if (!edit) {
    throw new Error("保存单元格后查询失败");
  }

  return {
    rowIndex: edit.row_index,
    columnKey: edit.column_key,
    value: edit.value_json,
    revision: edit.revision,
    updatedById: edit.updated_by_id,
    updatedByName: edit.updated_by_name,
    updatedAt: edit.updated_at,
  };
}
