import type { Server } from 'http';

type RuntimeEvent = 'SIGTERM' | 'SIGINT' | 'unhandledRejection' | 'uncaughtException';

interface RuntimeEventSource {
  once(event: RuntimeEvent, listener: (...args: unknown[]) => void): unknown;
}

interface RuntimeLogger {
  error: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
}

interface ShutdownOptions {
  server: Pick<Server, 'close'>;
  cleanup?: () => Promise<void> | void;
  timeoutMs?: number;
  logger?: RuntimeLogger;
  exit?: (code: number) => never | void;
  eventSource?: RuntimeEventSource;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

interface ShutdownController {
  shutdown: (event: RuntimeEvent, exitCode: number, reason?: unknown) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function closeServer(server: Pick<Server, 'close'>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err?: Error) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function formatReason(reason: unknown): unknown {
  if (reason instanceof Error) {
    return { name: reason.name, message: reason.message, stack: reason.stack };
  }
  return reason;
}

export function createShutdownController({
  server,
  cleanup,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = console,
  exit = process.exit,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}: ShutdownOptions): ShutdownController {
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | null = null;
  let requestedExitCode = 0;

  async function shutdown(event: RuntimeEvent, exitCode: number, reason?: unknown): Promise<void> {
    if (exitCode !== 0) requestedExitCode = 1;
    if (shuttingDown) {
      if (exitCode !== 0) {
        logger.error(`[Runtime] ${event} received during shutdown; forcing nonzero exit`, formatReason(reason));
      }
      return shutdownPromise ?? Promise.resolve();
    }
    shuttingDown = true;
    requestedExitCode = exitCode === 0 ? requestedExitCode : 1;

    const isFatal = exitCode !== 0;
    const log = isFatal ? logger.error : logger.log;
    log(`[Runtime] ${event} received; starting graceful shutdown`, formatReason(reason));

    let finalExitCode = requestedExitCode;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    shutdownPromise = (async () => {
      await Promise.race([
        (async () => {
          let shutdownError: unknown;
          try {
            await closeServer(server);
          } catch (err) {
            shutdownError = err;
          }

          try {
            await cleanup?.();
          } catch (err) {
            shutdownError ??= err;
          }

          if (shutdownError) throw shutdownError;
        })(),
        new Promise<never>((_, reject) => {
          timeout = setTimeoutFn(() => {
            reject(new Error(`Graceful shutdown timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
      logger.log('[Runtime] Graceful shutdown complete');
    })();

    try {
      await shutdownPromise;
      finalExitCode = requestedExitCode;
    } catch (err) {
      finalExitCode = 1;
      logger.error('[Runtime] Graceful shutdown failed', formatReason(err));
    } finally {
      if (timeout) clearTimeoutFn(timeout);
      exit(finalExitCode);
    }
  }

  return { shutdown };
}

export function installRuntimeShutdownHandlers(
  controller: ShutdownController,
  eventSource: RuntimeEventSource = process
): void {
  eventSource.once('SIGTERM', () => {
    void controller.shutdown('SIGTERM', 0);
  });
  eventSource.once('SIGINT', () => {
    void controller.shutdown('SIGINT', 0);
  });
  eventSource.once('unhandledRejection', (reason) => {
    void controller.shutdown('unhandledRejection', 1, reason);
  });
  eventSource.once('uncaughtException', (error) => {
    void controller.shutdown('uncaughtException', 1, error);
  });
}
