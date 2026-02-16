import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#010005",
        "bg-secondary": "#110f1a",
        "bg-tertiary": "#1C1827",
        border: "#2c273e",
        text: "#e5e7eb",
        "text-secondary": "#a1a1aa",
        "text-muted": "#52525b",
        accent: "#7C3AED",
        "accent-hover": "#6d28d9",
        blue: "#3B82F6",
        cyan: "#22d3ee",
        green: "#4ade80",
        red: "#f87171",
      },
      boxShadow: {
        glow: "0 0 60px -15px rgba(124, 58, 237, 0.4), 0 0 20px -10px rgba(124, 58, 237, 0.2)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-space-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
