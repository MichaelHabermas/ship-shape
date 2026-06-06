// Shared subprocess helpers: tail collectors, exit waits, and sleep.
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTailCollector(maxChars = 6_000) {
  let value = '';
  return {
    push(chunk) {
      value += chunk.toString();
      if (value.length > maxChars) value = value.slice(-maxChars);
    },
    text() {
      return value;
    },
  };
}

export function onceExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      if (child.exitCode && child.exitCode !== 0) {
        reject(new Error(`Process ${child.pid} exited with ${child.exitCode}`));
        return;
      }
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for process ${child.pid} to exit`));
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code && code !== 0) {
        reject(new Error(`Process ${child.pid} exited with ${code}`));
        return;
      }
      resolve();
    });
  });
}

export function tailText(value, maxChars = 6_000) {
  const text = String(value ?? '');
  return text.length > maxChars ? text.slice(-maxChars) : text;
}
