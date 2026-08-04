"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/register-service-worker";

// Mounted once in app/layout.tsx (a server component, hence this tiny
// client wrapper) so the service worker registers on every page, not just
// the dashboard — a Background Fetch registered from the dashboard still
// needs an active service worker even if the user has since navigated
// elsewhere or closed the tab entirely.
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}
