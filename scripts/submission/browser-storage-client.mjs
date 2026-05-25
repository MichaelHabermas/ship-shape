/** Inlined into generated reviewer/security HTML. See docs/conventions/browser-storage.md */
export function renderQuietStorageHelpers() {
  return `
      function readStoredString(key, fallback) {
        try {
          return localStorage.getItem(key) ?? fallback;
        } catch {
          return fallback;
        }
      }
      function writeStoredString(key, value) {
        try {
          localStorage.setItem(key, value);
        } catch {}
      }
      function readStoredJson(key, fallback) {
        try {
          const raw = localStorage.getItem(key);
          if (!raw) return fallback;
          return JSON.parse(raw);
        } catch {
          return fallback;
        }
      }
      function writeStoredJson(key, value) {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch {}
      }
  `;
}
