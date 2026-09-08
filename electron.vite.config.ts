import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const r = (p: string) => resolve(fileURLToPath(new URL('.', import.meta.url)), p);

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': r('src/shared') },
    },
    build: {
      rollupOptions: {
        output: { format: 'cjs' },
      },
    },
  },
  preload: {
    // Preload 必须是单个 CJS 文件（sandbox: true 禁止 require 本地模块）
    resolve: {
      alias: { '@shared': r('src/shared') },
    },
    build: {
      rollupOptions: {
        output: { format: 'cjs' },
      },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': r('src/renderer'),
        '@shared': r('src/shared'),
      },
    },
  },
});
