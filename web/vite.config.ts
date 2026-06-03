// Vite config serves the React app while proxying API, realtime, and OAuth protocol routes.
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
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
  const apiTarget = `http://localhost:${apiPort}`;
  const frameProtectionHeaders = {
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
  };

  // Proxy configuration shared between dev and preview servers
  const proxyConfig = {
    '/api': {
      target: apiTarget,
      changeOrigin: true,
    },
    '/collaboration': {
      target: apiTarget,
      changeOrigin: true,
      ws: true,
    },
    '/events': {
      target: apiTarget,
      changeOrigin: true,
      ws: true,
    },
    '/oauth/authorize': {
      target: apiTarget,
      changeOrigin: true,
    },
    '/oauth/token': {
      target: apiTarget,
      changeOrigin: true,
    },
    '/oauth/device/verify': {
      target: apiTarget,
      changeOrigin: true,
    },
    '/oauth/consent/request': {
      target: apiTarget,
      changeOrigin: true,
    },
    '/oauth/consent/approve': {
      target: apiTarget,
      changeOrigin: true,
    },
  };

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
        '@ship/sdk': resolve(__dirname, '../sdk/src/index.ts'),
      },
    },
    server: {
      port: parseInt(process.env.VITE_PORT || env.VITE_PORT || '5173'),
      strictPort: true,
      headers: frameProtectionHeaders,
      proxy: proxyConfig,
    },
    // Preview server config - used by `vite preview` for E2E tests
    // This is MUCH lighter weight than the dev server (no HMR, no watchers)
    preview: {
      port: parseInt(env.VITE_PORT || '4173'),
      strictPort: true,
      headers: frameProtectionHeaders,
      proxy: proxyConfig,
    },
  };
});
