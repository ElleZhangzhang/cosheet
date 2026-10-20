import type { ParsedSheet } from "@/types";
import type { UploadedChunkInfo } from "@/types/api";
import type { UploadTaskMeta } from "@/types/uploadTask";

const ROWS_PER_CHUNK = 500;

// 某个分片应该包含多少行：500/小于500
function expectedChunkRows(index: number, rowCount: number): number {
  return Math.min(ROWS_PER_CHUNK, rowCount - index * ROWS_PER_CHUNK);
}

// 根据服务端已上传分片，获取缺失的分片
// reutrn [index0,index2,index11]
function computeMissingChunks(
  rowCount: number,
  chunkCount: number,
  serverChunks: UploadedChunkInfo[]
): number[] {
  const validUploaded = new Set(
    serverChunks
      .filter(
        (chunk) =>
          Number.isInteger(chunk.index) &&
          chunk.index >= 0 &&
          chunk.index < chunkCount
      )
      .filter(
        (chunk) =>
          chunk.rowCount === expectedChunkRows(chunk.index, rowCount)
      )
      .map((chunk) => chunk.index)
  );

  return Array.from(
    { length: chunkCount },
    (_, index) => index
  ).filter((index) => !validUploaded.has(index));
}

// 浏览器保存的 File 是否仍是当初上传的文件
function isSameStoredFile(
  file: File,
  meta: UploadTaskMeta
): boolean {
  return (
    file.name === meta.fileName &&
    file.size === meta.fileSize &&
    file.lastModified === meta.lastModified
  );
}

// 重新解析后的行数是否与任务一致
function isCompatibleSheet(
  sheet: ParsedSheet,
  rowCount: number
): boolean {
  return sheet.rowCount === rowCount;
}

export {
  ROWS_PER_CHUNK,
  expectedChunkRows,
  computeMissingChunks,
  isSameStoredFile,
  isCompatibleSheet,
};
