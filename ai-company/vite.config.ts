import { defineConfig } from "vite";

// 画面（web/）を組み立てて dist/ に出力する。dist/ は Worker の Static Assets として配信される。
export default defineConfig({
  root: "web",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    // ローカル開発時、画面は Vite、API は wrangler dev（8787）へ転送する
    proxy: { "/api": "http://localhost:8787" },
  },
});
