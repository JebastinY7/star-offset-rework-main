import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, /api and /media are forwarded to Django, so the browser sees one origin
// (localhost:5175) and cookies/CSRF just work. 5175 keeps it apart from the admin app (5173)
// and the shop portal (5174).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/media": "http://127.0.0.1:8000",
      "/ws": { target: "ws://127.0.0.1:8000", ws: true }, // live notifications (WebSocket)
    },
  },
});
