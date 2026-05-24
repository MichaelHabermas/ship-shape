import { createServer } from 'http';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createShutdownController, installRuntimeShutdownHandlers } from './runtime/shutdown.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables (.env.local takes precedence)
config({ path: join(__dirname, '../.env.local') });
config({ path: join(__dirname, '../.env') });

async function main() {
  // Load secrets from SSM in production (before importing app)
  if (process.env.NODE_ENV === 'production') {
    const { loadProductionSecrets } = await import('./config/ssm.js');
    await loadProductionSecrets();
  }

  // Now import app after secrets are loaded
  const { createApp } = await import('./app.js');
  const { setupCollaboration } = await import('./collaboration/index.js');
  const { closeDatabasePool } = await import('./db/client.js');

  const PORT = process.env.PORT || 3000;
  const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

  const app = createApp(CORS_ORIGIN);
  const server = createServer(app);

  // DDoS protection: Set server-wide timeouts to prevent slow-read attacks (Slowloris)
  server.timeout = 60000; // 60 seconds max request duration
  server.keepAliveTimeout = 65000; // 65 seconds (slightly longer than timeout)
  server.headersTimeout = 66000; // 66 seconds (slightly longer than keepAlive)

  // Setup WebSocket collaboration server
  const closeCollaboration = setupCollaboration(server, { allowedOrigin: CORS_ORIGIN });

  const shutdownController = createShutdownController({
    server,
    cleanup: async () => {
      await closeCollaboration();
      await closeDatabasePool();
    },
  });
  installRuntimeShutdownHandlers(shutdownController);

  // Start server
  server.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
    console.log(`CORS origin: ${CORS_ORIGIN}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
