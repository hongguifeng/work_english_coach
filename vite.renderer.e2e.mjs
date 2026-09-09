// 独立 renderer dev server（E2E 用）：只起 Vite，不拉起 Electron。
// 与 electron.vite.config.ts 的 renderer 段保持一致。
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const r = (p) => resolve(fileURLToPath(new URL('.', import.meta.url)), p);

export default defineConfig({
  root: r('src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': r('src/renderer'),
      '@shared': r('src/shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // 必须绑 IPv4：Electron/Chromium 访问 localhost 时可能只试 127.0.0.1，
    // 若 vite 只监听 [::1] 会导致页面 document 永远不提交
    host: '127.0.0.1',
  },
});
