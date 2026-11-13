import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

const host = process.env.TAURI_DEV_HOST;
const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM || host);

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Path aliases
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@/bindings": resolve(__dirname, "./src/bindings.ts"),
    },
  },

  // Multiple entry points: the main app and the overlay
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        overlay: resolve(__dirname, "src/overlay/index.html"),
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port when running inside Tauri; web preview uses port 3000
  server: {
    port: isTauri ? 1420 : 3000,
    strictPort: true,
    host: isTauri ? host || false : "0.0.0.0",
    allowedHosts: isTauri ? undefined : true,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
