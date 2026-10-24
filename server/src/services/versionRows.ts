// 说明：读取 ready 版本的行数据，支持分页、搜索和排序

import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool";
import { readChunk } from "../storage/chunks";
import { HttpError } from "../utils/httpError";
import { validateRowsQuery } from "../utils/validate";
import type { FileColumnInput } from "../utils/validate";
import {
  getAllCellEdits,
  getCellEditsInRange,
} from "./cellEdits";
import type { CellEditsMap } from "./cellEdits";
import { assertWorkspaceAccess } from "./permissions";

interface VersionRowsContextRow extends RowDataPacket {
  id: string;
  row_count: number;
  chunk_count: number;
  status: string;
  columns_json: unknown;
  workspace_id: string;
}

interface IndexedRow {
  row: Record<string, unknown>; // {column1: value, column2: value}
  rowIndex: number;
}

interface RowsResult {
  rows: Array<Record<string, unknown> & { rowIndex: number }>;
  total: number;
  offset: number;
  limit: number;
}

// 查询版本及其所属文件、工作空间
async function getVersionRowsContext(
  versionId: string
): Promise<VersionRowsContextRow> {
  const [rows] = await pool.execute<VersionRowsContextRow[]>(
    `SELECT v.id, v.row_count, v.chunk_count, v.status, v.columns_json,
            f.workspace_id
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

// mysql2 可能把 JSON 列解析成对象，也可能返回字符串
function parseColumns(value: unknown): FileColumnInput[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;

  if (!Array.isArray(parsed)) {
    throw new Error("版本列定义损坏");
  }

  return parsed as FileColumnInput[];
}

// 读取指定范围内的分片，并补上全局 rowIndex
async function readIndexedRows(
  versionId: string,
  startChunk: number,
  endChunk: number
): Promise<IndexedRow[]> {
  const chunkIndices = Array.from(
    { length: endChunk - startChunk + 1 },
    (_, index) => startChunk + index
  );

  // FIND Promise.all如果reject了会怎样
  // 1.任意一个readFile或JSON.parse失败，对应的Promise就reject
  // 2.Promise.all在第一个reject出现时立即reject，返回值是那个错误
  // 3. await 抛出同一个错误。
  // 4. readIndexedRows 内部没有 try/catch，所以该错误继续向上抛。
  // 5. async 函数自动把抛出的错误包装成 Promise.reject(同一个错误) 返回。
  // 6. 调用方 await readIndexedRows(...) 再次抛出。
  // 7. 最终被 asyncHandler 的.catch(next) 接住。
  const chunks = await Promise.all(
    chunkIndices.map((index) =>
      readChunk<Record<string, unknown>>(versionId, index)
    )
  );

  // 跨分片读取合并
  const result: IndexedRow[] = [];
  chunks.forEach((chunkRows, chunkOffset) => {
    const chunkIndex = startChunk + chunkOffset;
    chunkRows.forEach((row, localIndex) => {
      result.push({ row, rowIndex: chunkIndex * 500 + localIndex });
    });
  });

  return result;
}

// 搜索：
// 1.不做大小写区分
// 2.通过row[column.keyName]按照column + row进行单元格搜索，即搜索的是value
// 3.一个row长这样：{{column1:value},{column2:value},...}
function matchesQuery(
  row: Record<string, unknown>,
  columns: FileColumnInput[],
  q: string
): boolean {
  const needle = q.toLowerCase();

  return columns.some((column) => {
    const value = row[column.keyName];
    return (
      value !== null &&
      value !== undefined &&
      String(value).toLowerCase().includes(needle)
    );
  });
}

// 把值转成可比较的 number/string；空值和无效值返回 null
function getComparable(
  value: unknown,
  type: FileColumnInput["type"]
): number | string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (type === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  if (type === "date") {
    const time = Date.parse(String(value));
    return Number.isNaN(time) ? null : time;
  }

  return String(value);
}

// 排序比较器
function compareIndexedRows(
  a: IndexedRow,
  b: IndexedRow,
  column: FileColumnInput,
  sortDir: "asc" | "desc"
): number {
  const aValue = getComparable(a.row[column.keyName], column.type);
  const bValue = getComparable(b.row[column.keyName], column.type);

  if (aValue === null || bValue === null) {
    if (aValue === null && bValue === null) {
      return a.rowIndex - b.rowIndex;
    }
    return aValue === null ? 1 : -1;
  }

  let result: number;
  if (typeof aValue === "number" && typeof bValue === "number") {
    result = aValue - bValue;
  } else {
    result = String(aValue).localeCompare(String(bValue));
  }

  if (result !== 0) {
    return sortDir === "asc" ? result : -result;
  }

  return a.rowIndex - b.rowIndex;
}

// 用 cell_edits 覆盖基础行
function applyCellEdits(
  rows: IndexedRow[],
  edits: CellEditsMap
): void {
  for (const item of rows) {
    const rowEdits = edits.get(item.rowIndex);

    if (rowEdits) {
      item.row = { ...item.row, ...rowEdits };
    }
  }
}

// 接收前端的翻页、搜索、排序请求，从磁盘里把对应的分片文件读出来，处理完后再返回给前端
export async function getVersionRows(
  userId: string,
  versionId: string,
  rawQuery: Record<string, unknown>
): Promise<RowsResult> {
  const version = await getVersionRowsContext(versionId);
  await assertWorkspaceAccess(userId, version.workspace_id);

  if (version.status !== "ready") {
    throw new HttpError(409, "版本尚未完成上传");
  }

  const columns = parseColumns(version.columns_json);
  const query = validateRowsQuery(rawQuery, columns);

  let indexedRows: IndexedRow[];
  let total: number;

  // 无搜索和排序，直接返回所请求的rows即可
  if (!query.q && !query.sortBy) {
    total = version.row_count;

    if (query.offset >= total) {
      return {
        rows: [],
        total,
        offset: query.offset,
        limit: query.limit,
      };
    }

    // 1.跨分片读取合并（数据存在磁盘的分片里，每片 500 行）
    const startChunk = Math.floor(query.offset / 500);
    const endChunk = Math.min(
      version.chunk_count - 1,
      Math.floor((query.offset + query.limit - 1) / 500)
    );
    indexedRows = await readIndexedRows(versionId, startChunk, endChunk);

    // 2.分页
    const startInChunk = query.offset - startChunk * 500;
    indexedRows = indexedRows.slice(
      startInChunk,
      startInChunk + query.limit
    );

    // 先覆盖单元格编辑，再返回给前端
    if (indexedRows.length > 0) {
      const firstRow = indexedRows[0];
      const lastRow = indexedRows[indexedRows.length - 1];

      if (firstRow && lastRow) {
        const edits = await getCellEditsInRange(
          versionId,
          firstRow.rowIndex,
          lastRow.rowIndex
        );
        applyCellEdits(indexedRows, edits);
      }
    }
  } else {
    // OPTIMIZE 能不能再优化下
    // 1.全量拉取
    indexedRows = await readIndexedRows(
      versionId,
      0,
      version.chunk_count - 1
    );

    // 2.覆盖单元格编辑，搜索/排序必须使用编辑后的值
    const edits = await getAllCellEdits(versionId);
    applyCellEdits(indexedRows, edits);

    // 3.搜索：搜索每一个单元格
    if (query.q) {
      indexedRows = indexedRows.filter(({ row }) =>
        matchesQuery(row, columns, query.q)
      );
    }

    total = query.q ? indexedRows.length : version.row_count;

    // 4.排序
    if (query.sortBy) {
      const sortColumn = columns.find(
        (column) => column.keyName === query.sortBy
      );

      if (sortColumn) {
        indexedRows.sort((a, b) =>
          compareIndexedRows(a, b, sortColumn, query.sortDir)
        );
      }
    }

    // 分页，其实就是跨分片读取之后做页内切片
    indexedRows = indexedRows.slice(
      query.offset,
      query.offset + query.limit
    );
  }

  return {
    rows: indexedRows.map(({ row, rowIndex }) => ({ ...row, rowIndex })),
    total,
    offset: query.offset,
    limit: query.limit,
  };
}
