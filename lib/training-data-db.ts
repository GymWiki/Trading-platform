"use client";

// Tiny IndexedDB wrapper so the app can discover a training-data download
// that finished in the background — including while this tab was fully
// closed — the next time it's opened. Schema must stay in sync by hand
// with public/sw.js's own copy (that file can't import this one — see its
// doc comment for why).
const DB_NAME = "freqpanda-training-data";
const DB_VERSION = 1;
const STORE_NAME = "pending-downloads";

export interface PendingDownload {
  botId: string;
  uploadSessionId: string;
  files: Array<{ pair: string; timeframe: string }>;
  completedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: "botId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// One pending completed download per bot — matches the existing rule that
// a bot can only ever have one training job in flight (see
// TrainingBusyError in lib/train-cloud.ts), so there's never more than one
// meaningful "background fetch finished, awaiting confirmation" record per
// bot to track.
export async function getPendingDownload(botId: string): Promise<PendingDownload | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(botId);
    req.onsuccess = () => resolve((req.result as PendingDownload | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearPendingDownload(botId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(botId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
