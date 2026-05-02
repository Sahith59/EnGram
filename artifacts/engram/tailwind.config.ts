import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        gh: {
          bg: "#0d1117",
          canvas: "#161b22",
          border: "#30363d",
          muted: "#8b949e",
          text: "#e6edf3",
        },
        engram: {
          DEFAULT: "#7c3aed",
          light: "#a78bfa",
        },
        tool: {
          chatgpt: "#10a37f",
          claude: "#d4623a",
          gemini: "#4285f4",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
