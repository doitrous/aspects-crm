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
        // App surfaces
        canvas: "#eef1f4", // page background
        panel: "#ffffff", // cards / panels
        sidebar: "#fafbfc",
        toolbar: "#fcfcfd",
        // Primary (clinic blue)
        primary: {
          DEFAULT: "#2f6fed",
          hover: "#1d4ed8",
          soft: "#eff4ff", // soft blue chip bg
          softer: "#eef4ff",
          avatar: "#d1e0ff",
        },
        // Text ramp
        ink: {
          900: "#101828",
          700: "#344054",
          600: "#475467",
          500: "#667085",
          400: "#98a2b3",
        },
        // Borders / hairlines
        line: {
          DEFAULT: "#e4e7ec",
          soft: "#eaecf0",
          softer: "#f0f1f4",
          faint: "#f2f4f7",
        },
        // Status
        danger: { DEFAULT: "#b42318", bg: "#fef3f2", dot: "#f04438" },
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
