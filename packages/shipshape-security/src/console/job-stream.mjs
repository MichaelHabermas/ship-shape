/**
 * Attach a job listener; replay buffered logs and terminal done for late subscribers.
 * @param {{ logs: string[], listeners: Set<Function>, done: boolean, result: object|null }} job
 * @param {(msg: object) => void} send
 */
export function attachJobStream(job, send) {
  for (const line of job.logs) send({ type: 'log', line });
  job.listeners.add(send);
  if (job.done && job.result) send({ type: 'done', ...job.result });
  return () => job.listeners.delete(send);
}

export function formatSseMessage(msg) {
  return `data: ${JSON.stringify(msg)}\n\n`;
}
