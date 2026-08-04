"use client";

// Registers public/sw.js — needed for the Background Fetch training-data
// download (see lib/background-fetch-download.ts) to survive the user
// closing this tab or switching apps. A no-op (not an error) wherever
// service workers aren't available at all — this app works fine without
// one, Background Fetch support is checked separately and falls back to
// the foreground download path (lib/client-data-download.ts) regardless.
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  // Called from ServiceWorkerRegistrar's useEffect, i.e. after hydration —
  // by then `window`'s own 'load' event has, in practice, almost always
  // already fired (confirmed via a headless-browser check: registering
  // this the textbook `window.addEventListener('load', ...)` way silently
  // never ran). Register immediately once the document is actually
  // interactive/complete, and only fall back to waiting for 'load' on the
  // rare chance this runs before that.
  if (document.readyState === "complete") {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[sw] registration failed:", err);
    });
  } else {
    window.addEventListener(
      "load",
      () => {
        navigator.serviceWorker.register("/sw.js").catch((err) => {
          console.error("[sw] registration failed:", err);
        });
      },
      { once: true },
    );
  }
}
