import type { Config } from "tailwindcss";

/**
 * Design tokens extracted verbatim from the Aspects Clinica prototype
 * (Clinic Prototype (standalone).html). This is the single source of truth
 * for the CRM visual language. Do not introduce colors outside this scale.
 */
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Semantic surfaces/text/lines are driven by CSS variables (see
        // app/globals.css) so a single `[data-theme="dark"]` block re-themes
        // every existing `bg-panel` / `text-ink-900` / `border-line-soft`
        // utility — including the whole financial UI — with no per-component
        // churn. The `rgb(var(--x) / <alpha-value>)` form preserves Tailwind
        // opacity modifiers like `bg-primary/40`.
        canvas: "rgb(var(--c-canvas) / <alpha-value>)", // page background
        panel: "rgb(var(--c-panel) / <alpha-value>)", // cards / panels
        sidebar: "rgb(var(--c-sidebar) / <alpha-value>)",
        toolbar: "rgb(var(--c-toolbar) / <alpha-value>)",
        // Primary (clinic blue)
        primary: {
          DEFAULT: "rgb(var(--c-primary) / <alpha-value>)",
          hover: "rgb(var(--c-primary-hover) / <alpha-value>)",
          soft: "rgb(var(--c-primary-soft) / <alpha-value>)", // soft blue chip bg
          softer: "rgb(var(--c-primary-softer) / <alpha-value>)",
          avatar: "rgb(var(--c-primary-avatar) / <alpha-value>)",
        },
        // Text ramp
        ink: {
          900: "rgb(var(--c-ink-900) / <alpha-value>)",
          700: "rgb(var(--c-ink-700) / <alpha-value>)",
          600: "rgb(var(--c-ink-600) / <alpha-value>)",
          500: "rgb(var(--c-ink-500) / <alpha-value>)",
          400: "rgb(var(--c-ink-400) / <alpha-value>)",
        },
        // Borders / hairlines
        line: {
          DEFAULT: "rgb(var(--c-line) / <alpha-value>)",
          soft: "rgb(var(--c-line-soft) / <alpha-value>)",
          softer: "rgb(var(--c-line-softer) / <alpha-value>)",
          faint: "rgb(var(--c-line-faint) / <alpha-value>)",
        },
        // Status (danger themed via vars so alerts stay readable on dark)
        danger: {
          DEFAULT: "rgb(var(--c-danger) / <alpha-value>)",
          bg: "rgb(var(--c-danger-bg) / <alpha-value>)",
          dot: "rgb(var(--c-danger-dot) / <alpha-value>)",
        },
        success: { DEFAULT: "#067647", strong: "#12b76a" },
        warn: { DEFAULT: "#b54708", strong: "#dc6803" },
        // Warm "clinic" aesthetic accents (Playfair headings, cream cards)
        clinic: {
          ink: "#3a2e24",
          muted: "#8a7a68",
          terracotta: "#b8734a",
          cream: "#eadfce",
          sand: "#a89a88",
        },
        // Categorical badge hues (stages / tags)
        badge: {
          indigo: "#3538cd",
          pink: "#c11574",
          amber: "#b54708",
          blue: "#175cd3",
        },
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        display: ["var(--font-playfair)", "Playfair Display", "Georgia", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        card: "16px",
        control: "9px",
        pill: "20px",
      },
      boxShadow: {
        card: "0 4px 24px rgba(16,24,40,.06)",
        toast: "0 12px 34px rgba(16,24,40,.28)",
        focus: "0 0 0 3px rgba(47,111,237,.12)",
      },
      keyframes: {
        slidein: {
          from: { transform: "translateX(30px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        fadein: { from: { opacity: "0" }, to: { opacity: "1" } },
        toastin: {
          from: { transform: "translateY(16px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        pop: {
          "0%": { transform: "scale(.9)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        drawerin: {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
      },
      animation: {
        slidein: "slidein .28s ease",
        fadein: "fadein .2s ease",
        toastin: "toastin .32s ease",
        pop: "pop .18s ease",
        drawerin: "drawerin .3s cubic-bezier(.32,.72,0,1)",
      },
    },
  },
  plugins: [],
};

export default config;
