import { describe, expect, it, vi } from 'vitest';
import { createShutdownController, installRuntimeShutdownHandlers } from './shutdown.js';

function createServer(closeImpl?: (callback: (err?: Error) => void) => void) {
  return {
    close: vi.fn((callback: (err?: Error) => void) => {
      if (closeImpl) {
        closeImpl(callback);
        return;
      }
      callback();
    }),
  };
}

function createLogger() {
  return {
    log: vi.fn(),
    error: vi.fn(),
  };
}

describe('runtime shutdown', () => {
  it('registers signal and fatal process handlers once each', () => {
    const controller = { shutdown: vi.fn() };
    const eventSource = { once: vi.fn() };

    installRuntimeShutdownHandlers(controller, eventSource);

    expect(eventSource.once).toHaveBeenCalledTimes(4);
    expect(eventSource.once).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(eventSource.once).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(eventSource.once).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
    expect(eventSource.once).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
  });

  it('gracefully shuts down on SIGTERM and exits cleanly', async () => {
    const server = createServer();
    const cleanup = vi.fn();
    const exit = vi.fn();
    const logger = createLogger();
    const controller = createShutdownController({ server, cleanup, exit, logger });

    await controller.shutdown('SIGTERM', 0);

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.log).toHaveBeenCalledWith('[Runtime] Graceful shutdown complete');
  });

  it('treats unhandled rejections and uncaught exceptions as fatal shutdowns', async () => {
    const server = createServer();
    const cleanup = vi.fn();
    const exit = vi.fn();
    const logger = createLogger();
    const controller = createShutdownController({ server, cleanup, exit, logger });
    const reason = new Error('lost async work');

    await controller.shutdown('unhandledRejection', 1, reason);

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[Runtime] unhandledRejection received; starting graceful shutdown',
      expect.objectContaining({ message: 'lost async work' })
    );
  });

  it('does not run cleanup twice and upgrades exit code when a fatal event arrives during shutdown', async () => {
    let closeServer!: () => void;
    const server = createServer((callback) => {
      closeServer = () => callback();
    });
    const cleanup = vi.fn();
    const exit = vi.fn();
    const controller = createShutdownController({ server, cleanup, exit, logger: createLogger() });

    const firstShutdown = controller.shutdown('SIGINT', 0);
    const secondShutdown = controller.shutdown('uncaughtException', 1, new Error('second'));
    closeServer();
    await firstShutdown;
    await secondShutdown;

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('runs cleanup even when HTTP server close fails', async () => {
    const server = createServer((callback) => callback(new Error('server close failed')));
    const cleanup = vi.fn();
    const exit = vi.fn();
    const logger = createLogger();
    const controller = createShutdownController({ server, cleanup, exit, logger });

    await controller.shutdown('SIGTERM', 0);

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[Runtime] Graceful shutdown failed',
      expect.objectContaining({ message: 'server close failed' })
    );
  });

  it('exits nonzero when cleanup fails', async () => {
    const server = createServer();
    const cleanup = vi.fn(async () => {
      throw new Error('cleanup failed');
    });
    const exit = vi.fn();
    const logger = createLogger();
    const controller = createShutdownController({ server, cleanup, exit, logger });

    await controller.shutdown('SIGTERM', 0);

    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[Runtime] Graceful shutdown failed',
      expect.objectContaining({ message: 'cleanup failed' })
    );
  });

  it('exits nonzero when graceful shutdown times out', async () => {
    const server = createServer(() => {});
    const exit = vi.fn();
    const logger = createLogger();
    const setTimeoutFn = vi.fn((callback: () => void) => {
      callback();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutFn = vi.fn();
    const controller = createShutdownController({
      server,
      exit,
      logger,
      timeoutMs: 1,
      setTimeoutFn,
      clearTimeoutFn,
    });

    await controller.shutdown('uncaughtException', 1, new Error('boom'));

    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[Runtime] Graceful shutdown failed',
      expect.objectContaining({ message: 'Graceful shutdown timed out after 1ms' })
    );
  });
});
