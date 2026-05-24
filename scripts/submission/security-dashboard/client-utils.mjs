/** Browser helper functions inlined into the security console IIFE. */
export function renderClientUtils() {
  return `
        const FILTER_STORAGE_KEY = 'ship-security-console-filters-v1';
        const PREFS_STORAGE_KEY = 'ship-security-console-prefs-v1';
        let focusTrapPrevious = null;
        let focusTrapHandler = null;

        function escapeHtml(value) {
          return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        }

        function loadPrefs() {
          try {
            return JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) || '{}') || {};
          } catch {
            return {};
          }
        }

        function savePrefs(prefs) {
          try {
            localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
          } catch {
            /* ignore */
          }
        }

        function loadFilters() {
          try {
            return JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) || '{}') || {};
          } catch {
            return {};
          }
        }

        function saveFilters(filters) {
          try {
            localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
          } catch {
            /* ignore */
          }
        }

        async function copyText(text, toastEl) {
          const value = String(text ?? '');
          try {
            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(value);
            } else {
              const ta = document.createElement('textarea');
              ta.value = value;
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              ta.remove();
            }
            if (toastEl) {
              toastEl.textContent = 'Copied to clipboard';
              toastEl.hidden = false;
              setTimeout(() => {
                toastEl.hidden = true;
              }, 2000);
            }
          } catch {
            if (toastEl) {
              toastEl.textContent = 'Copy failed';
              toastEl.hidden = false;
            }
          }
        }

        function trapFocus(container) {
          const focusable = container.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (!focusable.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          focusTrapHandler = (e) => {
            if (e.key !== 'Tab') return;
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          };
          container.addEventListener('keydown', focusTrapHandler);
          first.focus();
        }

        function releaseFocus(container) {
          if (focusTrapHandler) {
            container.removeEventListener('keydown', focusTrapHandler);
            focusTrapHandler = null;
          }
          if (focusTrapPrevious && typeof focusTrapPrevious.focus === 'function') {
            focusTrapPrevious.focus();
            focusTrapPrevious = null;
          }
        }
  `;
}
