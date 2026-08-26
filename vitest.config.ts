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
    // Tests live only in tests/ (one file per src/ module). Scope discovery
    // there so a local `conduct` symlink to the plugin tree is never traversed.
    include: ['tests/**/*.test.ts'],
  },
});
