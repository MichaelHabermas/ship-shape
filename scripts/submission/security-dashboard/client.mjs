import { renderClientUtils } from './client-utils.mjs';

export function renderSecurityClientScript() {
  return `
      (function initSecurityConsole() {
        ${renderClientUtils()}
        const payloadEl = document.getElementById('ship-security-payload');
        if (!payloadEl) return;
        let payload;
        try {
          payload = JSON.parse(payloadEl.textContent || '{}');
        } catch {
          return;
        }

        let findingsById = new Map((payload.findings || []).map((f) => [f.id, f]));
        let selectedFindingId = null;
        let consoleOnline = false;
        let jobSocket = null;
        let drawerEditMode = false;

        const runProbeBtn = document.getElementById('security-run-probe');
        const runCheckBtn = document.getElementById('security-run-check');
        const runCiBtn = document.getElementById('security-run-ci');
        const refreshBtn = document.getElementById('security-refresh-page');
        const perimeterToggle = document.getElementById('security-cat8-perimeter');
        const autoRefreshToggle = document.getElementById('security-auto-refresh');
        const hintEl = document.getElementById('security-console-hint');
        const toastEl = document.getElementById('security-console-toast');
        const logPanel = document.getElementById('security-run-log');
        const logTitle = document.getElementById('security-run-log-title');
        const logBody = document.getElementById('security-run-log-body');
        const copyLogBtn = document.getElementById('security-copy-log');
        const searchInput = document.getElementById('security-finding-search');
        const statusFilter = document.getElementById('security-finding-status-filter');
        const activeFilter = document.getElementById('security-finding-active-filter');
        const countEl = document.getElementById('security-finding-count');
        const tbody = document.getElementById('security-findings-tbody');
        const drawer = document.getElementById('security-finding-drawer');
        const drawerInner = drawer?.querySelector('.security-drawer-inner');
        const drawerTitle = document.getElementById('security-drawer-title');
        const drawerBody = document.getElementById('security-drawer-body');
        const drawerClose = document.getElementById('security-drawer-close');
        const drawerStatus = document.getElementById('security-drawer-status');
        const drawerSave = document.getElementById('security-drawer-save');
        const ciModal = document.getElementById('security-ci-modal');
        const ciConfirm = document.getElementById('security-ci-confirm');
        const ciCancel = document.getElementById('security-ci-cancel');
        const offlineHintHtml = hintEl ? hintEl.innerHTML : '';

        const prefs = loadPrefs();
        if (autoRefreshToggle && prefs.autoRefresh !== false) autoRefreshToggle.checked = true;
        const savedFilters = loadFilters();
        if (searchInput && savedFilters.search) searchInput.value = savedFilters.search;
        if (statusFilter && savedFilters.status) statusFilter.value = savedFilters.status;
        if (activeFilter && savedFilters.active) activeFilter.value = savedFilters.active;
        if (perimeterToggle && savedFilters.cat8Perimeter) perimeterToggle.checked = true;

        function apiBase() {
          return payload.consoleApiBase || '';
        }

        function wsBase() {
          const base = apiBase();
          if (!base) return null;
          return base.replace(/^http/i, (match) => (match.toLowerCase() === 'https' ? 'wss' : 'ws'));
        }

        function persistFilters() {
          saveFilters({
            search: searchInput?.value || '',
            status: statusFilter?.value || '',
            active: activeFilter?.value || '',
            cat8Perimeter: Boolean(perimeterToggle?.checked),
          });
        }

        function setConsoleUi(online) {
          consoleOnline = online;
          if (runProbeBtn) runProbeBtn.disabled = !online;
          if (runCheckBtn) runCheckBtn.disabled = !online;
          if (runCiBtn) runCiBtn.disabled = !online;
          if (drawerStatus) drawerStatus.disabled = !online;
          if (drawerSave) drawerSave.disabled = !online;
          if (hintEl) {
            hintEl.innerHTML = online
              ? 'Security console connected. Grader path: <code>pnpm security:probe:ci</code>. Console can mirror CI for local preflight.'
              : offlineHintHtml;
          }
        }

        async function pingConsole() {
          try {
            const res = await fetch(apiBase() + '/api/health', { cache: 'no-store' });
            if (!res.ok) return setConsoleUi(false);
            const data = await res.json();
            setConsoleUi(Boolean(data.ok));
          } catch {
            setConsoleUi(false);
          }
        }

        function appendLog(line) {
          if (!logBody) return;
          logBody.textContent += line + '\\n';
          logBody.scrollTop = logBody.scrollHeight;
        }

        function openLog(title) {
          if (!logPanel) return;
          logPanel.hidden = false;
          logPanel.classList.add('is-running');
          if (logTitle) logTitle.textContent = title;
          if (logBody) logBody.textContent = '';
        }

        function closeLog(title, ok) {
          if (!logPanel) return;
          logPanel.classList.remove('is-running');
          if (logTitle) logTitle.textContent = title + (ok ? ' — done' : ' — failed');
        }

        function statusChipClass(status) {
          if (status === 'fixed' || status === 'control') return 'pass';
          if (status === 'open') return 'warn';
          return '';
        }

        function renderFindingRow(finding) {
          const location = (finding.primaryLocations || []).join(', ');
          const searchText = [finding.id, finding.title, finding.status, finding.severity, location, finding.category]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          const v = finding.lastVerification;
          const verText = v
            ? escapeHtml((v.result || '') + ' · ' + (v.runId || v.method || v.at || ''))
            : 'not recorded';
          const sevClass =
            finding.severity === 'critical' || finding.severity === 'high' ? '5' : '3';
          return (
            '<tr class="security-finding-row" tabindex="0" role="button" data-finding-id="' +
            escapeHtml(finding.id) +
            '" data-status="' +
            escapeHtml(finding.status) +
            '" data-severity="' +
            escapeHtml(finding.severity) +
            '" data-active="' +
            escapeHtml(finding.activeLabel) +
            '" data-search="' +
            escapeHtml(searchText) +
            '"><td><strong>' +
            escapeHtml(finding.id) +
            '</strong></td><td><span class="impact-pill impact-' +
            sevClass +
            '">' +
            escapeHtml(finding.severity || 'n/a') +
            '</span></td><td><span class="test-chip ' +
            escapeHtml(statusChipClass(finding.status)) +
            '">' +
            escapeHtml(finding.status) +
            '</span></td><td>' +
            escapeHtml(finding.activeLabel) +
            '</td><td>' +
            escapeHtml([finding.owasp, finding.category].filter(Boolean).join(' / ')) +
            '</td><td><span class="path" title="' +
            escapeHtml(location) +
            '">' +
            escapeHtml(location) +
            '</span></td><td>' +
            escapeHtml(finding.title || finding.id) +
            '</td><td>' +
            verText +
            '</td></tr>'
          );
        }

        function applyPayload(next) {
          payload = next;
          payloadEl.textContent = JSON.stringify(payload);
          findingsById = new Map((payload.findings || []).map((f) => [f.id, f]));
          if (tbody) {
            tbody.innerHTML = (payload.findings || []).map(renderFindingRow).join('');
          }
          const metrics = payload.metrics || {};
          const cards = document.querySelectorAll('#panel-security .security-mini strong');
          if (cards[3] && metrics.latestConfirmedFindings != null) {
            cards[3].textContent = String(metrics.latestConfirmedFindings);
          }
          if (cards[5] && metrics.activeBacklog != null) cards[5].textContent = String(metrics.activeBacklog);
          applyFindingFilters();
        }

        async function refreshPayloadHot() {
          try {
            const res = await fetch(apiBase() + '/api/payload', { cache: 'no-store' });
            if (!res.ok) throw new Error('payload fetch failed');
            const next = await res.json();
            applyPayload(next);
            return true;
          } catch {
            return false;
          }
        }

        function watchJobWs(jobId, title, onDone) {
          const base = wsBase();
          if (!base) {
            closeLog(title, false);
            appendLog('WebSocket unavailable (open via pnpm security:console).');
            return;
          }
          if (jobSocket) jobSocket.close();
          const wsUrl = base + '/api/run/' + encodeURIComponent(jobId) + '/ws';
          jobSocket = new WebSocket(wsUrl);
          let settled = false;
          const timeoutMs = title === 'CI gate' ? 2 * 60 * 60 * 1000 : 60 * 60 * 1000;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            jobSocket?.close();
            jobSocket = null;
            closeLog(title, false);
            appendLog('Job timed out waiting for completion.');
          }, timeoutMs);
          const finish = (ok) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            jobSocket?.close();
            jobSocket = null;
            closeLog(title, ok);
            if (onDone) onDone(ok);
          };
          jobSocket.onmessage = (event) => {
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === 'log') appendLog(msg.line);
              if (msg.type === 'done') finish(Boolean(msg.ok));
            } catch {
              appendLog(event.data);
            }
          };
          jobSocket.onerror = () => finish(false);
          jobSocket.onclose = () => {
            if (!settled) finish(false);
          };
        }

        async function regenerateAndReload() {
          appendLog('Regenerating dashboard…');
          const res = await fetch(apiBase() + '/api/dashboard/regenerate', { method: 'POST' });
          const data = await res.json();
          if (res.status === 409) {
            appendLog(data.error || 'Another job is running');
            return false;
          }
          if (!res.ok || !data.jobId) {
            appendLog(data.error || 'Regenerate failed');
            return false;
          }
          return new Promise((resolve) => {
            watchJobWs(data.jobId, 'Dashboard regenerate', (ok) => resolve(ok));
          });
        }

        async function afterJobSuccess() {
          if (autoRefreshToggle?.checked === false) return;
          await pingConsole();
          if (!consoleOnline) {
            appendLog('Auto-refresh skipped (console offline).');
            return;
          }
          const hot = await refreshPayloadHot();
          if (hot) {
            appendLog('Reloading page to sync all dashboard sections…');
            window.location.reload();
            return;
          }
          const ok = await regenerateAndReload();
          if (ok) window.location.reload();
          else appendLog('Auto-refresh failed — use Refresh page.');
        }

        function subscribeJob(jobId, title) {
          watchJobWs(jobId, title, (ok) => {
            if (ok) afterJobSuccess();
          });
        }

        async function startRun(mode) {
          const titles = { run: 'Security probe', check: 'Findings check', ci: 'CI gate' };
          const title = titles[mode] || 'Run';
          openLog(title);
          const body = {
            mode,
            cat8Perimeter: Boolean(perimeterToggle?.checked),
          };
          const res = await fetch(apiBase() + '/api/run', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (res.status === 409) {
            appendLog(data.error || 'Another run is already in progress');
            if (data.jobId) appendLog('Job id: ' + data.jobId);
            closeLog(title, false);
            return;
          }
          if (!res.ok || !data.jobId) {
            appendLog(data.error || 'Run failed to start');
            closeLog(title, false);
            return;
          }
          subscribeJob(data.jobId, title);
        }

        function applyFindingFilters() {
          if (!tbody) return;
          persistFilters();
          const q = (searchInput?.value || '').trim().toLowerCase();
          const status = statusFilter?.value || '';
          const active = activeFilter?.value || '';
          let visible = 0;
          for (const row of tbody.querySelectorAll('.security-finding-row')) {
            const matchQ = !q || (row.dataset.search || '').includes(q);
            const matchStatus = !status || row.dataset.status === status;
            const matchActive = !active || row.dataset.active === active;
            const show = matchQ && matchStatus && matchActive;
            row.hidden = !show;
            if (show) visible += 1;
          }
          if (countEl) countEl.textContent = visible + ' / ' + (payload.findings?.length || 0) + ' shown';
        }

        function renderDrawerActions(findingId) {
          const finding = findingsById.get(findingId);
          const narrative = payload.narratives?.[findingId];
          return (
            '<div class="security-drawer-actions">' +
            '<button type="button" class="security-action-btn security-copy-btn" data-copy-finding-id="' +
            escapeHtml(findingId) +
            '">Copy ID</button>' +
            (narrative?.markdown
              ? '<button type="button" class="security-action-btn security-copy-btn" data-copy-narrative="' +
                escapeHtml(findingId) +
                '">Copy narrative MD</button>'
              : '') +
            (consoleOnline
              ? '<button type="button" class="security-action-btn" id="security-edit-narrative">Edit narrative</button>'
              : '') +
            '</div>'
          );
        }

        function openDrawer(findingId) {
          const finding = findingsById.get(findingId);
          if (!finding || !drawer) return;
          if (drawerInner && focusTrapHandler) releaseFocus(drawerInner);
          drawerEditMode = false;
          selectedFindingId = findingId;
          focusTrapPrevious = document.activeElement;
          if (drawerTitle) drawerTitle.textContent = finding.id + ': ' + (finding.title || '');
          if (drawerStatus) drawerStatus.value = finding.status || 'open';
          const narrative = payload.narratives?.[findingId];
          const verifications = (finding.verifications || [])
            .slice()
            .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
            .slice(0, 8)
            .map(
              (v) =>
                '<li><code>' +
                escapeHtml(v.result || '') +
                '</code> · ' +
                escapeHtml(v.method || '') +
                ' · ' +
                escapeHtml((v.at || '').slice(0, 19)) +
                (v.note ? ' — ' + escapeHtml(v.note) : '') +
                '</li>'
            )
            .join('');
          if (drawerBody) {
            drawerBody.innerHTML =
              renderDrawerActions(findingId) +
              '<p><strong>Status:</strong> ' +
              escapeHtml(finding.status || '') +
              ' · <strong>Severity:</strong> ' +
              escapeHtml(finding.severity || '') +
              ' · <strong>Active:</strong> ' +
              escapeHtml(finding.activeLabel || '') +
              '</p>' +
              '<p><strong>Definition:</strong> ' +
              escapeHtml(finding.definition || '—') +
              '</p>' +
              '<p><strong>Locations:</strong> ' +
              escapeHtml((finding.primaryLocations || []).join(', ') || '—') +
              '</p>' +
              '<p><strong>Probes:</strong> ' +
              escapeHtml((finding.probes || []).map((p) => p.probeId).join(', ') || '—') +
              '</p>' +
              '<h4>Verifications</h4><ul>' +
              (verifications || '<li>none</li>') +
              '</ul>' +
              '<div id="security-narrative-block">' +
              (narrative
                ? '<div class="security-narrative"><h4>Narrative</h4>' + narrative.html + '</div>'
                : '<p class="subtle">No narrative file linked.</p>') +
              '</div>';
          }
          drawer.hidden = false;
          drawer.setAttribute('aria-hidden', 'false');
          if (drawerInner) trapFocus(drawerInner);
          for (const row of tbody?.querySelectorAll('.security-finding-row') || []) {
            row.classList.toggle('is-selected', row.dataset.findingId === findingId);
          }
        }

        function closeDrawer() {
          if (drawerInner) releaseFocus(drawerInner);
          if (drawer) {
            drawer.hidden = true;
            drawer.setAttribute('aria-hidden', 'true');
          }
          selectedFindingId = null;
          drawerEditMode = false;
          for (const row of tbody?.querySelectorAll('.security-finding-row') || []) {
            row.classList.remove('is-selected');
          }
        }

        async function startNarrativeEdit() {
          if (!selectedFindingId || !consoleOnline) return;
          const res = await fetch(
            apiBase() + '/api/findings/' + encodeURIComponent(selectedFindingId) + '/narrative'
          );
          const data = await res.json();
          if (!res.ok) {
            appendLog(data.error || 'Cannot load narrative');
            return;
          }
          drawerEditMode = true;
          const block = document.getElementById('security-narrative-block');
          if (!block) return;
          block.innerHTML =
            '<h4>Edit narrative</h4><textarea id="security-narrative-editor" class="security-narrative-editor"></textarea><div class="security-drawer-actions"><button type="button" class="security-action-btn primary" id="security-narrative-save">Save</button><button type="button" class="security-action-btn" id="security-narrative-cancel">Cancel</button></div>';
          const editor = document.getElementById('security-narrative-editor');
          if (editor) editor.value = data.markdown;
        }

        async function saveNarrativeEdit() {
          const editor = document.getElementById('security-narrative-editor');
          if (!editor || !selectedFindingId) return;
          const markdown = editor.value;
          const res = await fetch(
            apiBase() + '/api/findings/' + encodeURIComponent(selectedFindingId) + '/narrative',
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ markdown }),
            }
          );
          const data = await res.json();
          if (!res.ok) {
            appendLog(data.error || 'Save failed');
            return;
          }
          if (!payload.narratives) payload.narratives = {};
          payload.narratives[selectedFindingId] = {
            path: data.path,
            markdown: data.markdown,
            html: data.html,
          };
          drawerEditMode = false;
          openDrawer(selectedFindingId);
          appendLog('Narrative saved for ' + selectedFindingId);
          if (logPanel) logPanel.hidden = false;
        }

        async function saveFindingStatus() {
          if (!selectedFindingId || !drawerStatus) return;
          const res = await fetch(apiBase() + '/api/findings/' + encodeURIComponent(selectedFindingId) + '/status', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: drawerStatus.value, note: 'set via security console' }),
          });
          const data = await res.json();
          if (!res.ok) {
            appendLog(data.error || 'Failed to save status');
            if (logPanel) logPanel.hidden = false;
            return;
          }
          const finding = findingsById.get(selectedFindingId);
          if (finding) {
            finding.status = drawerStatus.value;
            if (data.activeLabel) finding.activeLabel = data.activeLabel;
          }
          const row = tbody?.querySelector('[data-finding-id="' + CSS.escape(selectedFindingId) + '"]');
          if (row) {
            row.dataset.status = drawerStatus.value;
            if (data.activeLabel) {
              row.dataset.active = data.activeLabel;
              const activeCell = row.cells[3];
              if (activeCell) activeCell.textContent = data.activeLabel;
            }
          }
          applyFindingFilters();
          openDrawer(selectedFindingId);
          appendLog('Updated ' + selectedFindingId + ' → ' + drawerStatus.value);
          if (logPanel) logPanel.hidden = false;
        }

        if (searchInput) searchInput.addEventListener('input', applyFindingFilters);
        if (statusFilter) statusFilter.addEventListener('change', applyFindingFilters);
        if (activeFilter) activeFilter.addEventListener('change', applyFindingFilters);
        if (perimeterToggle) perimeterToggle.addEventListener('change', persistFilters);
        if (autoRefreshToggle) {
          autoRefreshToggle.addEventListener('change', () => {
            savePrefs({ ...loadPrefs(), autoRefresh: autoRefreshToggle.checked });
          });
        }
        if (drawerClose) drawerClose.addEventListener('click', closeDrawer);
        if (drawer) {
          drawer.addEventListener('click', (e) => {
            if (e.target === drawer) closeDrawer();
          });
        }
        if (drawerSave) drawerSave.addEventListener('click', saveFindingStatus);
        if (drawerBody) {
          drawerBody.addEventListener('click', (e) => {
            const copyId = e.target.closest('[data-copy-finding-id]');
            if (copyId) return copyText(copyId.dataset.copyFindingId, toastEl);
            const copyNar = e.target.closest('[data-copy-narrative]');
            if (copyNar) {
              const nar = payload.narratives?.[copyNar.dataset.copyNarrative];
              return copyText(nar?.markdown || '', toastEl);
            }
            if (e.target.id === 'security-edit-narrative') startNarrativeEdit();
            if (e.target.id === 'security-narrative-save') saveNarrativeEdit();
            if (e.target.id === 'security-narrative-cancel') openDrawer(selectedFindingId);
          });
        }
        if (copyLogBtn) {
          copyLogBtn.addEventListener('click', () => copyText(logBody?.textContent || '', toastEl));
        }
        document.querySelectorAll('[data-copy-command]').forEach((btn) => {
          btn.addEventListener('click', () => copyText(btn.dataset.copyCommand || '', toastEl));
        });
        if (refreshBtn) refreshBtn.addEventListener('click', () => window.location.reload());
        if (runProbeBtn) runProbeBtn.addEventListener('click', () => startRun('run'));
        if (runCheckBtn) runCheckBtn.addEventListener('click', () => startRun('check'));
        let ciModalPrevious = null;
        function openCiModal() {
          if (!ciModal) return;
          ciModalPrevious = document.activeElement;
          ciModal.hidden = false;
          const inner = ciModal.querySelector('.security-modal-inner');
          if (inner) trapFocus(inner);
          ciConfirm?.focus();
        }
        function closeCiModal() {
          if (!ciModal) return;
          const inner = ciModal.querySelector('.security-modal-inner');
          if (inner && focusTrapHandler) releaseFocus(inner);
          ciModal.hidden = true;
          ciModalPrevious?.focus?.();
          ciModalPrevious = null;
        }
        if (runCiBtn) runCiBtn.addEventListener('click', openCiModal);
        if (ciConfirm) {
          ciConfirm.addEventListener('click', () => {
            closeCiModal();
            startRun('ci');
          });
        }
        if (ciCancel) ciCancel.addEventListener('click', closeCiModal);
        if (ciModal) {
          ciModal.addEventListener('click', (e) => {
            if (e.target === ciModal) closeCiModal();
          });
        }

        if (tbody) {
          tbody.addEventListener('click', (e) => {
            const row = e.target.closest('.security-finding-row');
            if (!row) return;
            openDrawer(row.dataset.findingId);
          });
          tbody.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const row = e.target.closest('.security-finding-row');
            if (!row) return;
            e.preventDefault();
            openDrawer(row.dataset.findingId);
          });
        }

        for (const btn of document.querySelectorAll('.security-expand-btn')) {
          btn.addEventListener('click', () => {
            const id = btn.dataset.probeExpand;
            const detail = document.querySelector('[data-probe-detail="' + CSS.escape(id) + '"]');
            if (!detail) return;
            const open = detail.hidden;
            detail.hidden = !open;
            btn.setAttribute('aria-expanded', String(open));
          });
        }

        document.addEventListener('keydown', (e) => {
          if (e.key === '/' && document.getElementById('panel-security')?.classList.contains('active')) {
            const tag = document.activeElement?.tagName || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            e.preventDefault();
            searchInput?.focus();
          }
          if (e.key === 'Escape') {
            if (ciModal && !ciModal.hidden) {
              closeCiModal();
              return;
            }
            if (drawer && !drawer.hidden) closeDrawer();
          }
        });

        const openConsoleLink = document.querySelector('[data-open-security-console]');
        if (openConsoleLink) {
          openConsoleLink.addEventListener('click', (e) => {
            const tab = document.getElementById('tab-security');
            if (tab) {
              e.preventDefault();
              tab.click();
            }
          });
        }

        applyFindingFilters();
        pingConsole();
      })();`;
}
