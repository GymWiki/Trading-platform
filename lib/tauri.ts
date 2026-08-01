// Detects whether the app is running inside the Tauri desktop shell vs a
// plain browser tab. Used to gate features that need native capabilities
// (spawning a local FreqAI child process) that a web browser simply cannot
// do — same React components render in both contexts.
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
