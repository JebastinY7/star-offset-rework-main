import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, /api and /media are forwarded to Django, so the browser sees one
// origin (localhost:5173) and cookies/CSRF just work.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/media": "http://127.0.0.1:8000",
      "/ws": { target: "ws://127.0.0.1:8000", ws: true }, // live notifications (WebSocket)
    },
  },
});
