/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: ["src/lib/chat-markdown.test.ts", "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3400",
      "/gateway": {
        target: "ws://localhost:3400",
        ws: true,
      },
    },
  },
});
