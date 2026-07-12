import { log } from "./log.js";
import type { TransferRecord } from "../types.js";

// 传输历史持久化（IndexedDB）
const DB_NAME = "landrop";
const DB_VERSION = 1;
const STORE = "transfers";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 新增一条传输历史记录 */
export async function addHistory(
  record: Omit<TransferRecord, "id" | "timestamp">,
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add({ ...record, timestamp: Date.now() });
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch (e) {
    log.warn("写入传输历史失败:", e);
  }
}

/** 读取全部传输历史（按时间倒序） */
export async function getHistory(): Promise<TransferRecord[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readonly");
    const all = await new Promise<TransferRecord[]>((resolve) => {
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as TransferRecord[]) || []);
      req.onerror = () => resolve([]);
    });
    db.close();
    return all.sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}
