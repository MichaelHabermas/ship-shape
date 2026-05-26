import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/console/',
  server: {
    port: parseInt(process.env.VITE_CONSOLE_PORT || '5176', 10),
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
});
