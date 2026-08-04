// Minimal ambient types for the Background Fetch API — not yet part of
// TypeScript's bundled lib.dom.d.ts (Chromium-only, still an incubating
// spec), so lib/background-fetch-download.ts and any component reading a
// BackgroundFetchRegistration need this declared by hand. Only the members
// this app actually uses are typed; see
// https://wicg.github.io/background-fetch/ for the full surface.

interface BackgroundFetchOptions {
  icons?: Array<{ src: string; sizes?: string; type?: string }>;
  title?: string;
  downloadTotal?: number;
}

interface BackgroundFetchUIOptions {
  title?: string;
  icons?: Array<{ src: string; sizes?: string; type?: string }>;
}

type BackgroundFetchResult = "" | "success" | "failure";
type BackgroundFetchFailureReason =
  | ""
  | "aborted"
  | "bad-status"
  | "fetch-error"
  | "quota-exceeded"
  | "download-total-exceeded";

interface BackgroundFetchRegistration extends EventTarget {
  readonly id: string;
  readonly uploadTotal: number;
  readonly uploaded: number;
  readonly downloadTotal: number;
  readonly downloaded: number;
  readonly result: BackgroundFetchResult;
  readonly failureReason: BackgroundFetchFailureReason;
  readonly recordsAvailable: boolean;
  abort(): Promise<boolean>;
  updateUI(options?: BackgroundFetchUIOptions): Promise<void>;
  onprogress: ((this: BackgroundFetchRegistration, ev: Event) => unknown) | null;
}

interface BackgroundFetchManager {
  fetch(id: string, requests: string[] | Request[], options?: BackgroundFetchOptions): Promise<BackgroundFetchRegistration>;
  get(id: string): Promise<BackgroundFetchRegistration | undefined>;
  getIds(): Promise<string[]>;
}

interface ServiceWorkerRegistration {
  readonly backgroundFetch: BackgroundFetchManager;
}
