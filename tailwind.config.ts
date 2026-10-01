import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      spacing: {
        4.5: "1.125rem",
        5.5: "1.375rem"
      },
      colors: {
        brand: {
          50: "#faf5fc",
          100: "#f1e7f7",
          200: "#dbc7e7",
          300: "#c19ed5",
          400: "#a46fbd",
          500: "#8447a5",
          600: "#67288f",
          700: "#5b238e",
          800: "#481873",
          900: "#3c1265"
        },
        accent: {
          50: "#fff8ef",
          100: "#ffeccf",
          200: "#ffd7a6",
          300: "#ffc177",
          400: "#f8a34e",
          500: "#f28a2f",
          600: "#de7421",
          700: "#bc5b19",
          800: "#964716",
          900: "#793b15"
        },
        slate: {
          50: "#faf7f1",
          100: "#f4eee4",
          200: "#e4dacf",
          300: "#cfc0b1",
          400: "#9b8f91",
          500: "#756f78",
          600: "#5f5967",
          700: "#474250",
          800: "#2e2b3b",
          900: "#211f30",
          950: "#17182b"
        }
      },
      boxShadow: {
        soft: "0 24px 48px rgba(15, 23, 42, 0.1)"
      }
    }
  },
  plugins: []
};

export default config;
