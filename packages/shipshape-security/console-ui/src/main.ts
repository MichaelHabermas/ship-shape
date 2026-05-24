/** Vite console-ui entry — health check hook for optional standalone mount. */
const root = document.getElementById('ship-security-console-ui-root');
if (root) {
  root.dataset.consoleUiVersion = '1';
}

export function ping(apiBase: string): Promise<boolean> {
  return fetch(`${apiBase}/api/health`, { cache: 'no-store' })
    .then((res) => res.ok)
    .catch(() => false);
}
