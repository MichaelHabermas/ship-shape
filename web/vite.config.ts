import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';

// Read API port from environment or .ports file (created by scripts/dev.sh)
function getApiPort(): number {
  // Check for explicit API_PORT env var first (used by testcontainers)
  if (process.env.API_PORT) {
    return parseInt(process.env.API_PORT, 10);
  }

  const portsFile = resolve(__dirname, '../.ports');
  if (existsSync(portsFile)) {
    const content = readFileSync(portsFile, 'utf-8');
    const match = content.match(/^API=(\d+)/m);
    if (match) return parseInt(match[1], 10);
  }
  // Fallback to default
  return 3000;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiPort = getApiPort();

  // Proxy configuration shared between dev and preview servers
  const proxyConfig = {
    '/api': {
      target: `http://localhost:${apiPort}`,
      changeOrigin: true,
    },
    '/collaboration': {
      target: `http://localhost:${apiPort}`,
      changeOrigin: true,
      ws: true,
    },
    '/events': {
      target: `http://localhost:${apiPort}`,
      changeOrigin: true,
      ws: true,
    },
  };

  return {
    plugins: [
      react(),
      svgr({
        // Allow importing SVGs as React components with ?react suffix
        // e.g., import CheckIcon from '@uswds/uswds/dist/img/usa-icons/check.svg?react'
        svgrOptions: {
          // Use currentColor for fill to match existing icon patterns
          plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx'],
          svgoConfig: {
            plugins: [
              {
                name: 'preset-default',
                params: {
                  overrides: {
                    removeViewBox: false,
                  },
                },
              },
              // Replace hardcoded colors with currentColor
              {
                name: 'convertColors',
                params: {
                  currentColor: true,
                },
              },
            ],
          },
        },
      }),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    server: {
      port: parseInt(process.env.VITE_PORT || env.VITE_PORT || '5173'),
      strictPort: true,
      proxy: proxyConfig,
    },
    // Preview server config - used by `vite preview` for E2E tests
    // This is MUCH lighter weight than the dev server (no HMR, no watchers)
    preview: {
      port: parseInt(env.VITE_PORT || '4173'),
      strictPort: true,
      proxy: proxyConfig,
    },
  };
});
