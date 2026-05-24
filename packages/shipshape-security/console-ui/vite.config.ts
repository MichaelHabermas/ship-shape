import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/console/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
});
