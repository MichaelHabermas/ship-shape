/**
 * Single-flight job queue for the Security Console server.
 */

/**
 * @returns {{
 *   jobs: Map<string, import('./server.mjs').JobState>,
 *   getRunningJobId: () => string | null,
 *   tryStart: (kind: string, options: { cleanupMs: number, run: (jobId: string) => Promise<void> }) => { conflict: boolean, jobId: string }
 * }}
 */
export function createJobQueue() {
  /** @type {Map<string, { listeners: Set<Function>, done: boolean, logs: string[], result: object|null, cleanupMs: number }>} */
  const jobs = new Map();
  let runningJobId = null;
  let chain = Promise.resolve();

  function getRunningJobId() {
    return runningJobId;
  }

  function tryStart(kind, { cleanupMs, run }) {
    if (runningJobId) {
      return { conflict: true, jobId: runningJobId };
    }
    const jobId = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    runningJobId = jobId;
    jobs.set(jobId, { listeners: new Set(), done: false, logs: [], result: null, cleanupMs });

    chain = chain
      .then(() => run(jobId))
      .finally(() => {
        if (runningJobId === jobId) runningJobId = null;
        setTimeout(() => jobs.delete(jobId), cleanupMs);
      });

    return { conflict: false, jobId };
  }

  return { jobs, getRunningJobId, tryStart };
}
