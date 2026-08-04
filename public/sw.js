// Service worker for FreqPanda. Its only real job is Background Fetch: let
// the client-side training-data pre-fetch (see
// lib/background-fetch-download.ts and components/BotCard.tsx's
// handleStartCloudTraining) keep running after the user closes this tab or
// switches to another app, since the browser's download manager — not this
// page's JS — drives a Background Fetch registration once it's started.
// Deliberately NOT a caching/offline service worker: no fetch handler, no
// asset precaching, since nothing in this app needs offline support today.
// Registered from lib/register-service-worker.ts.

const DB_NAME = "freqpanda-training-data";
const DB_VERSION = 1;
const STORE_NAME = "pending-downloads";

// Mirrors lib/training-data-db.ts's schema exactly — duplicated rather
// than imported because this file is served as-is (no bundler runs over
// public/), so it can't share a TS module with the rest of the app. Keep
// both in sync by hand if this ever changes.
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: "botId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storePendingDownload(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Keeps only the latest candle for a given timestamp and returns everything
// sorted ascending — needed because lib/background-fetch-download.ts's
// request plan uses a fixed "since" grid (limit * timeframe-minutes apart)
// rather than paging off each response's own last candle like the
// foreground path does, so adjacent pages can legitimately overlap by a
// candle or two at the boundary.
function mergeCandlePages(candles) {
  const byTimestamp = new Map();
  for (const candle of candles) byTimestamp.set(candle[0], candle);
  return Array.from(byTimestamp.values()).sort((a, b) => a[0] - b[0]);
}

// Raw PUT straight to the signed URL — mirrors exactly what the training
// VM's own cloud-init upload step does (see UPLOADING stage in
// lib/hetzner.ts: "curl -X PUT $UPLOAD_URL --data-binary ..."), confirming
// a signed Supabase upload URL never needs anything beyond a plain PUT.
// Used here instead of the @supabase/supabase-js client's own
// uploadToSignedUrl helper (what the foreground path in
// lib/client-data-download.ts uses) because that SDK isn't loaded into
// this service worker.
async function uploadCandleFile(botId, uploadSessionId, pair, timeframe, candles) {
  const mintRes = await fetch("/api/train/cloud/upload-data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ botId, uploadSessionId, pair, timeframe }),
  });
  if (!mintRes.ok) return false;
  const { uploadUrl } = await mintRes.json();

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(candles),
  });
  return putRes.ok;
}

async function handleBackgroundFetchSuccess(bgFetch) {
  const idParts = bgFetch.id.split(":"); // "traindata:<botId>:<uploadSessionId>" — see lib/background-fetch-download.ts
  const botId = idParts[1];
  const uploadSessionId = idParts[2];

  const records = await bgFetch.matchAll();
  const groups = new Map(); // "<pair>|<timeframe>" -> candles[]

  for (const record of records) {
    const url = new URL(record.request.url);
    const pair = url.searchParams.get("pair");
    const timeframe = url.searchParams.get("timeframe");
    if (!pair || !timeframe) continue;

    let response;
    try {
      response = await record.responseReady;
    } catch {
      continue; // one failed/aborted record shouldn't sink every other pair/timeframe
    }
    if (!response.ok) continue;

    let candles = [];
    try {
      const data = await response.json();
      candles = Array.isArray(data.candles) ? data.candles : [];
    } catch {
      continue;
    }

    const key = `${pair}|${timeframe}`;
    if (!groups.has(key)) groups.set(key, { pair, timeframe, candles: [] });
    groups.get(key).candles.push(...candles);
  }

  const uploadedFiles = [];
  for (const { pair, timeframe, candles } of groups.values()) {
    const merged = mergeCandlePages(candles);
    if (merged.length === 0) continue; // nothing for this pair/timeframe in range — same "skip, don't upload an empty file" rule as the foreground path
    const ok = await uploadCandleFile(botId, uploadSessionId, pair, timeframe, merged);
    if (ok) uploadedFiles.push({ pair, timeframe });
  }

  const record = { botId, uploadSessionId, files: uploadedFiles, completedAt: Date.now() };
  await storePendingDownload(record);

  // Customizes the mandatory system notification Background Fetch already
  // shows (see step 3 of the original ask) so it reflects what actually
  // happened instead of the browser's generic default "Download complete".
  await bgFetch.updateUI({
    title:
      uploadedFiles.length > 0
        ? `Marktdata klaar (${uploadedFiles.length} bestanden) — open FreqPanda om de training te starten`
        : "Marktdata ophalen is mislukt — open FreqPanda om het opnieuw te proberen",
  });

  // If a tab happens to be open right now, let it react immediately
  // instead of making the user notice the system notification and reopen
  // the app themselves.
  const clientList = await self.clients.matchAll({ type: "window" });
  for (const client of clientList) {
    client.postMessage({ type: "training-data-ready", ...record });
  }
}

self.addEventListener("backgroundfetchsuccess", (event) => {
  event.waitUntil(handleBackgroundFetchSuccess(event.registration));
});

self.addEventListener("backgroundfetchfail", (event) => {
  event.waitUntil(
    event.registration.updateUI({
      title: "Marktdata ophalen is mislukt — open FreqPanda om het opnieuw te proberen",
    }),
  );
});

self.addEventListener("backgroundfetchabort", () => {
  // User (or the page) cancelled — nothing to upload, nothing to persist.
});
