import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
