import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  root: ".",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: false
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: false
  }
});
