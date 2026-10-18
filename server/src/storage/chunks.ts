// 说明：把云表格里的大数据（分片）以 JSON 文件的形式，保存到服务器的本地磁盘上，并提供读写、检查、删除的 API

import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../utils/httpError";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// path.resolve(参数)：结合当前NodeJS运行的工作目录，把参数转成一个绝对的磁盘路径
const storageRoot = path.resolve(process.env.STORAGE_DIR ?? "./storage");

function assertVersionId(versionId: string): void {
  if (!UUID_PATTERN.test(versionId)) {
    throw new HttpError(400, "版本 ID 不合法");
  }
}

function assertChunkIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0) {
    throw new HttpError(400, "分片索引不合法");
  }
}

function versionDir(versionId: string): string {
  assertVersionId(versionId);
  return path.join(storageRoot, "chunks", versionId);
}

// 返回数据库中保存的相对路径
export function storageKey(versionId: string, index: number): string {
  assertVersionId(versionId);
  assertChunkIndex(index);

  return path.posix.join("chunks", versionId, `${index}.json`);
  // KNOW
  // 1. .posix：告诉nodeJS无论在什么系统上都是用'/'而不是'\'来拼接
  // 2. return "chunks/550e8400-e29b-41d4-a716-446655440000/0.json"
}

// 磁盘上的绝对路径
export function chunkPath(versionId: string, index: number): string {
  assertVersionId(versionId);
  assertChunkIndex(index);

  return path.join(versionDir(versionId), `${index}.json`);
  // 1. return 'D:\vueLearning\CoSheet\storage\chunks\550e8400-e29b-41d4-a716-446655440000\0.json'
  // 2. 区别：其实就是正反斜杠导致的用途区别
  // (1)path.join --NodeJS真实的磁盘文件读写
  // (2)path.posix.join--存数据库、发给前端、未来上云
}

export async function writeChunk(
  versionId: string,
  index: number,
  rows: unknown[]
): Promise<string> {
  const filePath = chunkPath(versionId, index);
  // 创建目录
  await mkdir(path.dirname(filePath), { recursive: true });
  // 写入JSON.stringify(rows)
  await writeFile(filePath, JSON.stringify(rows), "utf8");

  return storageKey(versionId, index);
}

export async function readChunk<T = unknown>(
  versionId: string,
  index: number
): Promise<T[]> {
  const content = await readFile(chunkPath(versionId, index), "utf8");
  return JSON.parse(content) as T[];
}

export async function chunkFileExists(
  versionId: string,
  index: number
): Promise<boolean> {
  try {
    await access(chunkPath(versionId, index));
    return true;
  } catch {
    return false;
  }
}

export async function deleteVersionChunks(versionId: string): Promise<void> {
  await rm(versionDir(versionId), { recursive: true, force: true });
}
