// Vitest config for API unit tests and their Node dependency resolution.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    server: {
      deps: {
        external: [/[/\\]sdk[/\\]dist[/\\].*\.js$/],
      },
    },
    // Run test files sequentially to prevent database conflicts
    // Tests within each file can still run in parallel
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules', 'dist', 'src/test/**'],
    },
  },
})
