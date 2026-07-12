import { defineConfig } from "vite";

export default defineConfig({
  root: "frontend",
  build: {
    outDir: "dist",
    // CSP: 不注入内联 module preload polyfill（script-src 'self' 禁内联）
    modulePreload: { polyfill: false },
    // 字体等保持外部文件（font-src 'self' 不含 data:）
    assetsInlineLimit: 0,
  },
  server: {
    // dev: 前端走 vite :5173，API/WS 代理到 cargo :3000
    proxy: {
      "/ws": { target: "ws://localhost:3000", ws: true },
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
});
