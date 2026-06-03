// API bootstrap wires Express, collaboration, FleetGraph worker, and graceful shutdown.
import { createServer, type RequestListener } from 'http';
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
  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : 'localhost');
  const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
  let closeCollaboration: () => Promise<void> | void = () => undefined;
  let stopFleetGraphWorker: () => void | Promise<void> = () => undefined;
  let stopWebhookDeliveryWorker: () => void = () => undefined;

  const bootHealthHandler: RequestListener = (req, res) => {
    if (req.url?.split('?')[0] === '/health') {
      res.writeHead(200, {
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Origin': CORS_ORIGIN,
        'Content-Type': 'application/json; charset=utf-8',
        'Vary': 'Origin',
      });
      res.end(JSON.stringify({ status: 'starting' }));
      return;
    }

    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'API is starting' }));
  };
  const server = createServer(bootHealthHandler);

  // DDoS protection: Set server-wide timeouts to prevent slow-read attacks (Slowloris)
  server.timeout = 60000; // 60 seconds max request duration
  server.keepAliveTimeout = 65000; // 65 seconds (slightly longer than timeout)
  server.headersTimeout = 66000; // 66 seconds (slightly longer than keepAlive)

  const shutdownController = createShutdownController({
    server,
    cleanup: async () => {
      stopWebhookDeliveryWorker();
      await stopFleetGraphWorker();
      await closeCollaboration();
      const { closeDatabasePool } = await import('./db/client.js');
      await closeDatabasePool();
    },
  });
  installRuntimeShutdownHandlers(shutdownController);

  await new Promise<void>((resolve) => {
    server.listen(Number(PORT), HOST, () => {
      console.log(`API server listening on http://${HOST}:${PORT}`);
      console.log(`CORS origin: ${CORS_ORIGIN}`);
      resolve();
    });
  });

  // Load secrets from SSM in production (before importing app)
  if (process.env.NODE_ENV === 'production') {
    const { loadProductionSecrets } = await import('./config/ssm.js');
    await loadProductionSecrets();
  }

  // Now import app after secrets are loaded
  const { createApp } = await import('./app.js');
  const { setupCollaboration } = await import('./collaboration/index.js');

  const app = createApp(CORS_ORIGIN);
  server.removeListener('request', bootHealthHandler);
  server.on('request', app);

  // Setup WebSocket collaboration server
  closeCollaboration = setupCollaboration(server, { allowedOrigin: CORS_ORIGIN });

  const { startFleetGraphWorker } = await import('./fleetgraph/execution/worker.js');
  stopFleetGraphWorker = startFleetGraphWorker();

  const { bootstrapWebhooks } = await import('./platform/webhooks/bootstrap.js');
  bootstrapWebhooks();

  const { startWebhookDeliveryWorker } = await import('./platform/webhooks/worker.js');
  stopWebhookDeliveryWorker = startWebhookDeliveryWorker();

  console.log('API app ready');
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
