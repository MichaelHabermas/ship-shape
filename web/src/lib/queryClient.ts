import { QueryClient, MutationCache, QueryCache } from '@tanstack/react-query';
import { get, set, del, createStore } from 'idb-keyval';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import { getApiErrorStatus } from '@/lib/api-error';

// ===========================================
// Cache Schema Versioning
// ===========================================

// Increment this when cache schema changes to auto-clear old data
// v2: Removed local-first architecture (sync queues, pending mutations)
export const CACHE_SCHEMA_VERSION = 2;

// IndexedDB store for query cache
const queryStore = createStore('ship-query-cache', 'queries');

// IndexedDB store for metadata (schema version, etc)
const metaStore = createStore('ship-meta', 'meta');

// ===========================================
// Schema Migration
// ===========================================

async function checkAndMigrateSchema(): Promise<void> {
  try {
    const storedVersion = await get<number>('schema_version', metaStore);

    if (storedVersion === undefined) {
      // First time - just set version
      await set('schema_version', CACHE_SCHEMA_VERSION, metaStore);
      console.log('[Schema] Initialized schema version:', CACHE_SCHEMA_VERSION);
      return;
    }

    if (storedVersion !== CACHE_SCHEMA_VERSION) {
      console.log('[Schema] Version mismatch:', storedVersion, '->', CACHE_SCHEMA_VERSION);
      // Clear old cache data
      await del('tanstack-query', queryStore);
      // Update version
      await set('schema_version', CACHE_SCHEMA_VERSION, metaStore);
      console.log('[Schema] Cache cleared due to schema migration');
    }
  } catch (error) {
    console.warn('[Schema] Migration check failed:', error);
  }
}

// ===========================================
// Cache Corruption Detection & Recovery
// ===========================================

let cacheCorrupted = false;
let corruptionListeners: Array<(corrupted: boolean) => void> = [];

// ===========================================
// Mutation Error Events
// ===========================================

type MutationErrorListener = (error: Error, context: { operation?: string }) => void;
let mutationErrorListeners: MutationErrorListener[] = [];

export function subscribeToMutationErrors(listener: MutationErrorListener): () => void {
  mutationErrorListeners.push(listener);
  return () => {
    mutationErrorListeners = mutationErrorListeners.filter(l => l !== listener);
  };
}

function notifyMutationError(error: Error, context: { operation?: string }) {
  mutationErrorListeners.forEach(l => l(error, context));
}

export function isCacheCorrupted(): boolean {
  return cacheCorrupted;
}

export function subscribeToCacheCorruption(listener: (corrupted: boolean) => void): () => void {
  corruptionListeners.push(listener);
  if (cacheCorrupted) {
    listener(true);
  }
  return () => {
    corruptionListeners = corruptionListeners.filter(l => l !== listener);
  };
}

function notifyCorruptionListeners(corrupted: boolean) {
  cacheCorrupted = corrupted;
  corruptionListeners.forEach(l => l(corrupted));
}

export async function clearAllCacheData(): Promise<void> {
  try {
    await del('tanstack-query', queryStore);
    console.log('[Cache] Cleared all cache data');
    notifyCorruptionListeners(false);
  } catch (error) {
    console.error('[Cache] Failed to clear cache:', error);
    throw error;
  }
}

// Create IndexedDB persister for TanStack Query with corruption detection
export function createIDBPersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      try {
        await set('tanstack-query', client, queryStore);
      } catch (error) {
        console.error('[Persister] Failed to persist client:', error);
      }
    },
    restoreClient: async () => {
      try {
        const data = await get<PersistedClient>('tanstack-query', queryStore);
        if (data && typeof data !== 'object') {
          throw new Error('Invalid cache data structure');
        }
        return data;
      } catch (error) {
        console.error('[Persister] Cache corruption detected:', error);
        notifyCorruptionListeners(true);
        return undefined;
      }
    },
    removeClient: async () => {
      try {
        await del('tanstack-query', queryStore);
      } catch (error) {
        console.error('[Persister] Failed to remove client:', error);
      }
    },
  };
}

// Create the query client with stale-while-revalidate caching
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors (client errors)
        const status = getApiErrorStatus(error);
        if (status !== undefined) {
          if (status >= 400 && status < 500) return false;
        }
        return failureCount < 3;
      },
    },
    mutations: {
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors
        const status = getApiErrorStatus(error);
        if (status !== undefined) {
          if (status >= 400 && status < 500) return false;
        }
        return failureCount < 3;
      },
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      console.error(`Query ${query.queryKey} failed:`, error);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      console.error(`Mutation failed:`, error, mutation);
      // Notify listeners (for toast display)
      const operation = mutation.options.meta?.operation as string | undefined;
      notifyMutationError(error instanceof Error ? error : new Error(String(error)), { operation });
    },
  }),
});

// Persister instance
export const queryPersister = createIDBPersister();

// ===========================================
// Initialization
// ===========================================

if (typeof window !== 'undefined') {
  // Run initialization checks
  const initializeCache = async () => {
    await checkAndMigrateSchema();
  };

  initializeCache();
}
