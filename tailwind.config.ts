import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#0a0e14",
        surface: "#111722",
        surfaceHover: "#161d2b",
        border: "#232b3a",
        primary: {
          DEFAULT: "#22d3ee",
          hover: "#67e8f9",
        },
        accent: "#a78bfa",
        // FreqPanda brand palette (app/platform) — its own isolated
        // namespace so it can't collide with or drift the tokens above,
        // which the rest of the app (dashboard/platforms/settings) keeps
        // using untouched.
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
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        // FreqPanda's own type stack (app/platform) — separate utility
        // names so they can't shadow the app-wide sans/mono above.
        "panda-display": ["var(--font-panda-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        "panda-body": ["var(--font-panda-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        "panda-mono": ["var(--font-panda-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
