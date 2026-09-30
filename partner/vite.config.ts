import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The partner page (SPEC 4.6). Port 5174 matches the desktop app's dev invite links.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true, fs: { allow: [".."] } },
});
