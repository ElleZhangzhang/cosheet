import { openDB, type DBSchema } from "idb";
import type { VersionRow } from "@/types/api";

const DB_NAME = "cosheet-row-cache";
const DB_VERSION = 1;
const STORE_PAGES = "pages";
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CachedRowPage {
  key: string;
  versionId: string;
  queryKey: string;
  offset: number;
  limit: number;
  total: number;
  rows: VersionRow[];
  savedAt: number;
}

interface RowCacheDB extends DBSchema {
  pages: {
    key: string;
    value: CachedRowPage;
  };
}

let dbPromise: ReturnType<typeof openDB<RowCacheDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<RowCacheDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_PAGES)) {
          db.createObjectStore(STORE_PAGES, { keyPath: "key" });
        }
      },
    });
  }

  return dbPromise;
}

function buildRowCacheKey(
  versionId: string,
  queryKey: string,
  offset: number,
  limit: number
): string {
  return `${versionId}|${queryKey}|${offset}|${limit}`;
}

async function getCachedRowPage(
  versionId: string,
  queryKey: string,
  offset: number,
  limit: number
): Promise<CachedRowPage | null> {
  try {
    const db = await getDB();
    const key = buildRowCacheKey(versionId, queryKey, offset, limit);
    const page = await db.get(STORE_PAGES, key);

    if (!page) {
      return null;
    }

    if (Date.now() - page.savedAt > CACHE_TTL_MS) {
      await db.delete(STORE_PAGES, key);
      return null;
    }

    return page;
  } catch {
    return null;
  }
}

// KNOW Omit<T,K>：擦掉原T类型的K字段们
async function setCachedRowPage(
  page: Omit<CachedRowPage, "key" | "savedAt">
): Promise<void> {
  try {
    const db = await getDB();
    const key = buildRowCacheKey(
      page.versionId,
      page.queryKey,
      page.offset,
      page.limit
    );

    await db.put(STORE_PAGES, {
      ...page,
      key,
      savedAt: Date.now(),
    });
  } catch {
    // 缓存失败不影响正常请求
  }
}

async function clearVersionRowCache(versionId: string): Promise<void> {
  try {
    const db = await getDB();
    // 开启可读可写事务
    const tx = db.transaction(STORE_PAGES, "readwrite");
    // 事务聚焦在STORE_PAGES这个数据库
    const store = tx.objectStore(STORE_PAGES);

    const keys = await store.getAllKeys();
    for (const key of keys) {
      if (String(key).startsWith(`${versionId}|`)) {
        await store.delete(key);
      }
    }

    await tx.done;
  } catch {
    // 缓存清理失败不阻塞刷新
  }
}

export {
  buildRowCacheKey,
  getCachedRowPage,
  setCachedRowPage,
  clearVersionRowCache,
};
export type { CachedRowPage };
