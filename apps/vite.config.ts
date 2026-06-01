import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src-vue", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 3005,
    strictPort: true,
  },
  build: {
    outDir: "out",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vue: ["vue", "vue-router", "pinia"],
          element: ["element-plus", "@element-plus/icons-vue"],
          runtime: ["axios", "@tauri-apps/api"],
        },
      },
    },
  },
});
