import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@rcrsr/rill-config': path.resolve(__dirname, './src/index.ts'),
    },
  },
  test: {
    globals: false,
  },
});
