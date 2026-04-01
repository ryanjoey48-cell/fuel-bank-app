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
          50: "#f7f2ff",
          100: "#efe6ff",
          200: "#ddd0fb",
          300: "#c4aff6",
          400: "#a784ed",
          500: "#8456dc",
          600: "#5f33b7",
          700: "#5127a5",
          800: "#42208a",
          900: "#35196f"
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
          950: "#171128"
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
