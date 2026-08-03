import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // FreqPanda is now the app-wide theme, not just app/platform — these
        // base tokens are repointed to the same palette as `panda.*` below
        // so every existing bg-background/bg-surface/border-border/bg-primary
        // usage across the whole app (dashboard, platforms, settings,
        // login, signup) picks up the new look without a per-file rewrite.
        background: "#14171C", // = panda.ink
        surface: "#1E232B", // = panda.charcoal
        surfaceHover: "#272E38", // = panda.charcoal-light
        border: "#272E38", // = panda.charcoal-light
        primary: {
          DEFAULT: "#7CC576", // = panda.bamboo
          hover: "#5FA857", // = panda.bamboo-deep
        },
        // Secondary brand accent for a state that's deliberately distinct
        // from primary/bamboo (e.g. "cloud training" vs "local training" in
        // ui/Toggle.tsx) — a warm gold rather than the old cool violet, to
        // stay inside the same warm-ink-black family instead of clashing.
        accent: "#D6A75E",
        // Muted/secondary text and hairline borders throughout the app run
        // on Tailwind's stock slate scale (text-slate-400, border-slate-600,
        // etc.) — overriding just the shades actually in use here reskins
        // all of that in one place instead of hunting every call site.
        // slate-400 reuses panda.mist exactly so old and new components
        // read identically.
        slate: {
          100: "#F3EFE4", // = panda.cream
          200: "#D9D3C4",
          300: "#B7AF9C",
          400: "#8A93A3", // = panda.mist
          500: "#707785",
          600: "#3A414D",
          700: "#272E38", // = panda.charcoal-light
        },
        // Errors/destructive actions (panic button, form validation) run on
        // Tailwind's stock red scale — warmed to match panda.panic instead
        // of the old theme's cooler crimson.
        red: {
          300: "#F2A6A9",
          400: "#EB6E72",
          500: "#E5484D", // = panda.panic
        },
        // FreqPanda brand palette (app/platform, landing) — kept as its own
        // namespace too since those pages reference panda-* class names
        // directly; values match the base tokens above exactly.
        panda: {
          ink: "#14171C", // page background — warmer than a flat gray-900
          charcoal: "#1E232B", // card surface
          "charcoal-light": "#272E38", // nested surface: chart well, inputs
          bamboo: "#7CC576", // primary accent — positive figures, live/safe state
          "bamboo-deep": "#5FA857", // bamboo hover/active
          cream: "#F3EFE4", // warm off-white for high-contrast accents
          mist: "#8A93A3", // secondary/muted text
          panic: "#E5484D", // panic button
          "panic-deep": "#C93A3E", // panic hover/active
        },
      },
      fontFamily: {
        // App-wide type stack — now the same FreqPanda fonts app/platform
        // introduced (Manrope body, IBM Plex Mono data/labels), loaded
        // globally in app/layout.tsx under these variable names so every
        // existing font-sans/font-mono usage repoints automatically.
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        // Headings (see globals.css h1/h2/h3 base rule) and anywhere else
        // that wants the display face explicitly via `font-display`.
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        // app/platform + the landing page load their own page-scoped copies
        // of the same three fonts under these names — left as-is since
        // those pages already work and repointing them buys nothing.
        "panda-display": ["var(--font-panda-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        "panda-body": ["var(--font-panda-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        "panda-mono": ["var(--font-panda-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
