import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const projectRoot = process.cwd();

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(projectRoot, 'src/shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
