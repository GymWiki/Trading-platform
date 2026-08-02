"use client";

import { useEffect } from "react";

// Catches errors thrown from app/layout.tsx itself (the one place
// app/error.tsx can't reach, since it renders inside that layout). Must
// render its own <html>/<body> — this replaces the entire page, so it
// can't assume globals.css or any other app chrome is intact.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[GlobalError] Unhandled error in root layout:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0e17",
          color: "#e2e8f0",
          fontFamily: "system-ui, sans-serif",
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.75rem" }}>Er is iets misgegaan</h1>
          <p style={{ fontSize: "0.875rem", color: "#94a3b8", marginBottom: "1.5rem" }}>
            De applicatie is onverwacht gecrasht. Probeer de pagina te herladen.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              borderRadius: "0.5rem",
              background: "#22c55e",
              color: "#0a0e17",
              fontWeight: 600,
              fontSize: "0.875rem",
              padding: "0.5rem 1rem",
              border: "none",
              cursor: "pointer",
            }}
          >
            Probeer opnieuw
          </button>
        </div>
      </body>
    </html>
  );
}
