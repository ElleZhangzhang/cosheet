// 说明：localStorage存元数据，IndexedDB存原始File，提供保存/读取/删除

import { openDB, type DBSchema } from "idb";
import type { UploadTaskMeta } from "@/types/uploadTask";

const TASKS_KEY = "cosheet_upload_tasks";
const DB_NAME = "cosheet-uploads";
const DB_VERSION = 1;
const STORE_FILES = "files";

interface UploadTaskFileRecord {
  versionId: string;
  file: File;
  savedAt: number;
}

interface UploadTaskDB extends DBSchema {
  files: {
    key: string;
    value: UploadTaskFileRecord;
  };
}

let dbPromise: ReturnType<typeof openDB<UploadTaskDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<UploadTaskDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_FILES)) {
          db.createObjectStore(STORE_FILES, { keyPath: "versionId" });
        }
      },
    });
  }

  return dbPromise;
}

function isUploadTaskMeta(value: unknown): value is UploadTaskMeta {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const task = value as Partial<UploadTaskMeta>;

  return (
    typeof task.versionId === "string" &&
    typeof task.fileId === "string" &&
    typeof task.workspaceId === "string" &&
    typeof task.fileName === "string" &&
    typeof task.fileSize === "number" &&
    typeof task.lastModified === "number" &&
    typeof task.rowCount === "number" &&
    typeof task.chunkCount === "number" &&
    typeof task.createdAt === "number"
  );
}

function readTasks(): UploadTaskMeta[] {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    // return 数组对象
    return parsed.filter(isUploadTaskMeta);
  } catch {
    return [];
  }
}

function writeTasks(tasks: UploadTaskMeta[]): void {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

// return 按降序排列的所有任务
function loadUploadTaskMetas(): UploadTaskMeta[] {
  return [...readTasks()].sort((a, b) => b.createdAt - a.createdAt);
}

// 保存剩余tasks
async function saveUploadTask(
  meta: UploadTaskMeta,
  file: File
): Promise<void> {
  const db = await getDB();

  await db.put(STORE_FILES, {
    versionId: meta.versionId,
    file,
    savedAt: Date.now(),
  });

  // 重写localStorage的任务列表，已经存过这个版本的进度的话就删掉
  const tasks = readTasks().filter(
    (task) => task.versionId !== meta.versionId
  );
  // 把这次最新的进度（meta，包含已传了多少块等信息）加进去
  tasks.push(meta);
  writeTasks(tasks);
}

async function getUploadTaskFile(
  versionId: string
): Promise<File | null> {
  try {
    const db = await getDB();
    const record = await db.get(STORE_FILES, versionId);

    return record?.file ?? null;
  } catch {
    return null;
  }
}

async function removeUploadTask(versionId: string): Promise<void> {
  try {
    writeTasks(
      readTasks().filter((task) => task.versionId !== versionId)
    );
  } catch {
    // localStorage 可能不可用
  }

  try {
    const db = await getDB();
    await db.delete(STORE_FILES, versionId);
  } catch {
    // IndexedDB 可能不可用
  }
}

export {
  saveUploadTask,
  loadUploadTaskMetas,
  getUploadTaskFile,
  removeUploadTask,
};
