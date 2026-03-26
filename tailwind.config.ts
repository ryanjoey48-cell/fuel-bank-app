import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef7ff",
          100: "#d8ebff",
          200: "#badcff",
          300: "#88c4ff",
          400: "#4da1ff",
          500: "#1d7df2",
          600: "#0d62d2",
          700: "#0d4ea9",
          800: "#103f85",
          900: "#12376f"
        },
        slate: {
          950: "#08111f"
        }
      },
      boxShadow: {
        soft: "0 20px 45px rgba(8, 17, 31, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
