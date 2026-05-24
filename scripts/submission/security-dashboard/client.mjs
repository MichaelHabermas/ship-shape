export function renderSecurityClientScript() {
  return `
      (function initSecurityDashboard() {
        const toast = document.getElementById('security-copy-toast');
        function showCopied() {
          if (!toast) return;
          toast.hidden = false;
          toast.textContent = 'Copied';
          setTimeout(() => {
            toast.hidden = true;
          }, 2000);
        }
        for (const btn of document.querySelectorAll('#panel-security [data-copy-command]')) {
          btn.addEventListener('click', () => {
            const cmd = btn.getAttribute('data-copy-command') || '';
            if (!cmd) return;
            if (navigator.clipboard?.writeText) {
              navigator.clipboard.writeText(cmd).then(showCopied).catch(() => {});
            }
          });
        }
        for (const btn of document.querySelectorAll('#panel-security .security-expand-btn')) {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-probe-expand');
            if (!id) return;
            const detail = document.querySelector(
              '#panel-security [data-probe-detail="' + CSS.escape(id) + '"]'
            );
            if (!detail) return;
            detail.hidden = !detail.hidden;
            btn.setAttribute('aria-expanded', String(!detail.hidden));
          });
        }
      })();`;
}
