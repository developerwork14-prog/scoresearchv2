import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111111",
        slate: "#263238",
        teal: "#0f766e",
        mint: "#30d5a0",
        coral: "#e85d4f",
        gold: "#F5E6C8",
        mist: "#F7F7F7",
        cloud: "#FAFAFA",
        violet: "#6658d3"
      },
      boxShadow: {
        panel: "0 1px 3px rgba(17, 17, 17, 0.05)",
        soft: "0 1px 3px rgba(17, 17, 17, 0.05)"
      }
    }
  },
  plugins: []
};

export default config;
