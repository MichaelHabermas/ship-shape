#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  dashboardPath,
  escapeHtml,
  readLedger,
  repoRelative,
  sentenceList,
  statusClass,
  statusLabel,
  writeText,
} from './ledger-utils.mjs';

const validateLedgerScript = fileURLToPath(new URL('./validate-ledger.mjs', import.meta.url));

function badge(status) {
  return `<span class="badge ${statusClass(status)}">${escapeHtml(statusLabel(status))}</span>`;
}

function code(value) {
  return `<code>${escapeHtml(value)}</code>`;
}

function displayValue(value) {
  if (value === null || value === undefined) return 'N/A';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function resultBadge(result) {
  if (result === 'pass') return badge('proven');
  if (result === 'warn') return badge('partial');
  if (result === 'fail') return badge('open');
  return badge('needs_fill_in');
}

function metricCards(categories) {
  return categories
    .map((category) => {
      const primaryClaim = category.claims[0];
      const primaryTarget = category.targets?.[0];
      return `
        <article class="score-card">
          <header><span class="cat-id">Cat ${category.number}</span>${badge(category.status)}</header>
          <h3>${escapeHtml(category.title)}</h3>
          <p>${escapeHtml(primaryClaim?.statement || primaryTarget?.description || category.source_requirement.statement)}</p>
        </article>`;
    })
    .join('');
}

function categoryOption(category) {
  const failedTests = category.acceptance_tests.filter((test) => test.result === 'fail').length;
  const passedTests = category.acceptance_tests.filter((test) => test.result === 'pass').length;
  const warningTests = category.acceptance_tests.filter((test) => test.result === 'warn').length;
  return `
    <article class="panel span-4">
      <p class="eyebrow">Category ${category.number}</p>
      <h2>${escapeHtml(category.title)}</h2>
      <div class="status-row">${badge(category.status)}</div>
      <p>${escapeHtml(category.source_requirement.statement)}</p>
      <div class="mini-grid">
        <div class="mini"><strong>${category.rubric_items.length}</strong><span>rubric items</span></div>
        <div class="mini"><strong>${passedTests}</strong><span>acceptance pass</span></div>
        <div class="mini"><strong>${failedTests + warningTests}</strong><span>fail/warn</span></div>
      </div>
    </article>`;
}

function evidenceRows(categories) {
  return categories
    .map((category) => {
      const claim = category.claims[0];
      const testSummary = category.acceptance_tests
        .map((test) => `${test.result.toUpperCase()} ${test.id}`)
        .join('; ');
      const sourceSummary = category.sources.map((source) => code(source)).join('<br>');
      return `
        <tr>
          <td>Cat ${category.number}. ${escapeHtml(category.title)}</td>
          <td>${badge(category.status)}</td>
          <td>${escapeHtml(claim?.statement || '')}</td>
          <td>${escapeHtml(testSummary)}</td>
          <td>${sourceSummary}</td>
        </tr>`;
    })
    .join('');
}

function targetRows(categories) {
  return categories
    .flatMap((category) =>
      (category.targets || []).map(
        (target) => `
          <tr>
            <td>Cat ${category.number}</td>
            <td>${escapeHtml(target.id)}</td>
            <td>${escapeHtml(target.description)}</td>
            <td>${escapeHtml(target.operator)}</td>
            <td>${escapeHtml(displayValue(target.threshold))}</td>
            <td>${escapeHtml(displayValue(target.actual))}</td>
            <td>${resultBadge(target.result)}</td>
          </tr>`
      )
    )
    .join('');
}

function rubricRows(categories) {
  return categories
    .flatMap((category) =>
      category.rubric_items.map(
        (item) => `
          <tr>
            <td>Cat ${category.number}</td>
            <td>${escapeHtml(item.id)}</td>
            <td>${escapeHtml(item.phase)}</td>
            <td>${escapeHtml(item.status)}</td>
            <td>${code(item.location)}</td>
          </tr>`
      )
    )
    .join('');
}

function evidenceItems(category) {
  return (category.evidence || [])
    .map((item) => {
      const details = [
        item.path ? `Path: ${item.path}` : '',
        item.command ? `Command: ${item.command}` : '',
        item.result ? `Result: ${item.result}` : '',
      ].filter(Boolean);
      return `
        <li>
          <strong>${escapeHtml(item.id)} <span class="subtle">${escapeHtml(item.type)}</span></strong>
          <span>${escapeHtml(item.description)}${details.length ? ` ${escapeHtml(details.join(' | '))}` : ''}</span>
        </li>`;
    })
    .join('');
}

function nonClaimItems(categories) {
  return categories
    .flatMap((category) =>
      category.non_claims.map(
        (item) => `
          <li>
            <strong>Cat ${category.number}: ${escapeHtml(category.title)}</strong>
            <span>${escapeHtml(item)}</span>
          </li>`
      )
    )
    .join('');
}

function summaryCards(category) {
  return (category.summary_cards || [])
    .map(
      (card) => `
        <div class="summary-card">
          <h3>${escapeHtml(card.title)}</h3>
          <ul class="check-list">
            ${card.items
              .map(
                (item) => `
                  <li>
                    <strong>${escapeHtml(item.label)}</strong>
                    <span>${escapeHtml(item.value)}</span>
                  </li>`
              )
              .join('')}
          </ul>
        </div>`
    )
    .join('');
}

function categorySections(categories) {
  return categories
    .map(
      (category) => `
        <article class="panel span-12">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Category ${category.number}</p>
              <h2>${escapeHtml(category.title)}</h2>
            </div>
            ${badge(category.status)}
          </div>
          <p>${escapeHtml(category.source_requirement.statement)}</p>
          ${summaryCards(category)}
          <h3>Targets</h3>
          <ul class="check-list">
            ${(category.targets || [])
              .map(
                (target) => `
                  <li>
                    <strong>${escapeHtml(target.id)} ${resultBadge(target.result)}</strong>
                    <span>${escapeHtml(target.description)} Threshold: ${escapeHtml(displayValue(target.threshold))}; actual: ${escapeHtml(displayValue(target.actual))}. ${escapeHtml(target.reason || '')}</span>
                  </li>`
              )
              .join('')}
          </ul>
          <h3>Claims</h3>
          <ul class="check-list">
            ${category.claims
              .map(
                (claim) => `
                  <li>
                    <strong>${escapeHtml(claim.id)} ${badge(claim.status)}</strong>
                    <span>${escapeHtml(claim.statement)} ${escapeHtml(sentenceList(claim.limits))}</span>
                  </li>`
              )
              .join('')}
          </ul>
          <h3>Evidence</h3>
          <ul class="check-list">${evidenceItems(category)}</ul>
        </article>`
    )
    .join('');
}

function render(ledger) {
  const categories = [...ledger.categories].sort((a, b) => a.number - b.number);
  const statusCounts = categories.reduce((counts, category) => {
    counts[category.status] = (counts[category.status] || 0) + 1;
    return counts;
  }, {});
  const failedTests = categories.flatMap((category) =>
    category.acceptance_tests
      .filter((test) => test.result === 'fail')
      .map((test) => `Cat ${category.number}: ${test.id}`)
  );
  const warningTests = categories.flatMap((category) =>
    category.acceptance_tests
      .filter((test) => test.result === 'warn')
      .map((test) => `Cat ${category.number}: ${test.id}`)
  );
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ShipShape Reviewer Dashboard</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%2320201d'/%3E%3Cpath d='M3 4h10v2H3zm0 3h7v2H3zm0 3h10v2H3z' fill='%23fffdf8'/%3E%3C/svg%3E" />
    <style>
      :root { --bg:#f6f4ef; --paper:#fffdf8; --ink:#151515; --muted:#66635d; --line:#d8d1c3; --dark:#20201d; --proven-bg:#e7f2e5; --proven-ink:#24542a; --partial-bg:#fff3cf; --partial-ink:#73500b; --open-bg:#f7dedc; --open-ink:#7d2f28; --fill-bg:#e9edf3; --fill-ink:#38475d; }
      * { box-sizing: border-box; }
      body { margin:0; background:var(--bg); color:var(--ink); font-family:"Avenir Next","Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif; line-height:1.5; }
      .page { width:min(1240px, calc(100vw - 32px)); margin:0 auto; padding:28px 0 56px; }
      p,li,td,code { overflow-wrap:anywhere; }
      .hero { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(310px,.65fr); gap:18px; margin-bottom:18px; }
      .hero-main,.hero-side,.panel,.card,.table-wrap,.callout { background:var(--paper); border:1px solid var(--line); }
      .hero-main { padding:26px; min-height:270px; display:flex; flex-direction:column; justify-content:space-between; }
      .hero-side,.panel,.callout { padding:18px; }
      .eyebrow { margin:0 0 10px; color:var(--muted); font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
      h1,h2,h3,p { margin-top:0; }
      h1 { max-width:900px; margin-bottom:18px; font-family:Georgia,"Times New Roman",serif; font-size:clamp(36px,6vw,76px); line-height:.95; letter-spacing:0; }
      h2 { margin-bottom:12px; font-size:26px; line-height:1.15; }
      h3 { margin-bottom:8px; font-size:17px; line-height:1.2; }
      p { color:var(--muted); }
      .lede { max-width:820px; color:#34342f; font-size:18px; }
      .badge { display:inline-flex; align-items:center; min-height:26px; padding:4px 9px; border:1px solid transparent; border-radius:999px; font-size:12px; font-weight:800; line-height:1; white-space:nowrap; text-transform:capitalize; }
      .badge.proven { background:var(--proven-bg); border-color:#b6d6b2; color:var(--proven-ink); }
      .badge.partial { background:var(--partial-bg); border-color:#e2c77f; color:var(--partial-ink); }
      .badge.open { background:var(--open-bg); border-color:#e0aaa4; color:var(--open-ink); }
      .badge.fill { background:var(--fill-bg); border-color:#c8d1df; color:var(--fill-ink); }
      .tabs { position:sticky; top:0; z-index:10; display:flex; gap:6px; overflow-x:auto; padding:10px 0; margin:0 0 18px; background:color-mix(in srgb, var(--bg) 93%, transparent); backdrop-filter:blur(8px); border-bottom:1px solid var(--line); }
      .tab { appearance:none; border:1px solid var(--line); background:var(--paper); color:var(--dark); padding:9px 12px; font:inherit; font-size:14px; font-weight:750; cursor:pointer; white-space:nowrap; }
      .tab:hover { border-color:var(--dark); }
      .tab:focus-visible { border-color:var(--dark); outline:2px solid var(--dark); outline-offset:2px; }
      .tab[aria-selected="true"] { background:var(--dark); border-color:var(--dark); color:#fffdf8; }
      .tab-panel { display:none; }
      .tab-panel.active { display:block; }
      .section-grid { display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); gap:14px; margin-bottom:14px; }
      .span-12 { grid-column:span 12; } .span-8 { grid-column:span 8; } .span-6 { grid-column:span 6; } .span-4 { grid-column:span 4; }
      .score-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
      .score-card { min-height:170px; padding:14px; border:1px solid var(--line); background:var(--paper); display:flex; flex-direction:column; gap:10px; }
      .score-card header,.section-heading { display:flex; gap:8px; justify-content:space-between; align-items:flex-start; }
      .cat-id { color:var(--muted); font-size:12px; font-weight:850; letter-spacing:.06em; text-transform:uppercase; }
      .mini-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
      .mini { padding:12px; border:1px solid var(--line); background:#fbf8f0; }
      .mini strong { display:block; font-size:20px; line-height:1.1; }
      .mini span,.check-list span { color:var(--muted); font-size:13px; }
      .subtle { color:var(--muted); font-size:12px; font-weight:700; }
      .summary-card { margin:14px 0; }
      .check-list { display:grid; gap:10px; margin:0; padding:0; list-style:none; }
      .check-list li { padding:12px; border:1px solid var(--line); background:#fbf8f0; }
      .check-list strong { display:block; margin-bottom:3px; }
      .table-wrap { overflow-x:auto; }
      table { width:100%; min-width:760px; border-collapse:collapse; font-size:14px; }
      th,td { padding:12px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
      th { color:var(--muted); font-size:11px; font-weight:850; letter-spacing:.08em; text-transform:uppercase; }
      tr:last-child td { border-bottom:0; }
      code { padding:2px 5px; background:#eee7da; border:1px solid #ded3c0; font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace; font-size:.92em; }
      .footer { margin-top:28px; padding-top:18px; border-top:1px solid var(--line); color:var(--muted); font-size:13px; }
      .status-row { margin-bottom:10px; }
      @media (max-width: 960px) { .hero,.section-grid,.score-grid,.mini-grid { grid-template-columns:1fr; } .span-4,.span-6,.span-8,.span-12 { grid-column:auto; } }
      @media (max-width: 620px) { .page { width:min(100% - 20px,1240px); padding-top:14px; } .hero-main,.hero-side,.panel,.callout { padding:14px; } .tabs { margin-left:-10px; margin-right:-10px; padding-left:10px; padding-right:10px; } table { min-width:680px; } }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero" aria-labelledby="page-title">
        <div class="hero-main">
          <div>
            <p class="eyebrow">Generated From Evidence Ledger</p>
            <h1 id="page-title">ShipShape evidence dashboard</h1>
            <p class="lede">${escapeHtml(ledger.purpose)}</p>
          </div>
          <p>Generated from ${code('my-docs/evidence/submission-ledger.json')}.</p>
        </div>
        <aside class="hero-side" aria-label="Current review status">
          <p class="eyebrow">Reviewer Gate Snapshot</p>
          <div class="mini-grid">
            <div class="mini"><strong>${statusCounts.proven || 0}</strong><span>proven</span></div>
            <div class="mini"><strong>${statusCounts.partial || 0}</strong><span>partial</span></div>
            <div class="mini"><strong>${(statusCounts.open || 0) + (statusCounts.needs_fill_in || 0) + (statusCounts.not_measured || 0)}</strong><span>open/fill</span></div>
          </div>
          <div class="score-grid">${categories.map((category) => `<div>${badge(category.status)} <strong>Cat ${category.number}</strong></div>`).join('')}</div>
          <p>${failedTests.length === 0 && warningTests.length === 0 ? 'No failing or warning acceptance tests in the current ledger.' : `${failedTests.length > 0 ? `Failing acceptance tests: ${failedTests.map(escapeHtml).join('; ')}.` : 'No failing acceptance tests.'} ${warningTests.length > 0 ? `Warning acceptance tests: ${warningTests.map(escapeHtml).join('; ')}.` : ''}`}</p>
        </aside>
      </section>

      <nav class="tabs" role="tablist" aria-label="Dashboard sections">
        <button class="tab" id="tab-overview" role="tab" aria-selected="true" aria-controls="panel-overview" tabindex="0" data-tab="overview">Overview</button>
        <button class="tab" id="tab-evidence" role="tab" aria-selected="false" aria-controls="panel-evidence" tabindex="-1" data-tab="evidence">Evidence</button>
        <button class="tab" id="tab-targets" role="tab" aria-selected="false" aria-controls="panel-targets" tabindex="-1" data-tab="targets">Targets</button>
        <button class="tab" id="tab-rubric" role="tab" aria-selected="false" aria-controls="panel-rubric" tabindex="-1" data-tab="rubric">Rubric</button>
        <button class="tab" id="tab-boundaries" role="tab" aria-selected="false" aria-controls="panel-boundaries" tabindex="-1" data-tab="boundaries">Boundaries</button>
      </nav>

      <section id="panel-overview" class="tab-panel active" role="tabpanel" aria-labelledby="tab-overview" tabindex="0">
        <div class="section-grid">
          <div class="span-12"><div class="score-grid">${metricCards(categories)}</div></div>
          ${categories.map(categoryOption).join('')}
        </div>
      </section>

      <section id="panel-evidence" class="tab-panel" role="tabpanel" aria-labelledby="tab-evidence" tabindex="0" hidden>
        <div class="section-grid">${categorySections(categories)}</div>
        <div class="table-wrap"><table><thead><tr><th>Category</th><th>Status</th><th>Primary Claim</th><th>Acceptance Tests</th><th>Sources</th></tr></thead><tbody>${evidenceRows(categories)}</tbody></table></div>
      </section>

      <section id="panel-targets" class="tab-panel" role="tabpanel" aria-labelledby="tab-targets" tabindex="0" hidden>
        <div class="table-wrap"><table><thead><tr><th>Category</th><th>Target</th><th>Description</th><th>Operator</th><th>Threshold</th><th>Actual</th><th>Result</th></tr></thead><tbody>${targetRows(categories)}</tbody></table></div>
      </section>

      <section id="panel-rubric" class="tab-panel" role="tabpanel" aria-labelledby="tab-rubric" tabindex="0" hidden>
        <div class="table-wrap"><table><thead><tr><th>Category</th><th>Rubric Item</th><th>Phase</th><th>Status</th><th>Ledger Location</th></tr></thead><tbody>${rubricRows(categories)}</tbody></table></div>
      </section>

      <section id="panel-boundaries" class="tab-panel" role="tabpanel" aria-labelledby="tab-boundaries" tabindex="0" hidden>
        <article class="panel">
          <h2>Explicit Non-Claims</h2>
          <ul class="check-list">${nonClaimItems(categories)}</ul>
        </article>
      </section>

      <footer class="footer">
        Generated from ${code('my-docs/evidence/submission-ledger.json')} using ${code('pnpm submission:render-dashboard')}. Validate with ${code('pnpm submission:validate')}.
      </footer>
    </main>
    <script>
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
      function activateTab(tab, shouldFocus = true) {
        const target = tab.dataset.tab;
        for (const current of tabs) {
          current.setAttribute('aria-selected', String(current === tab));
          current.tabIndex = current === tab ? 0 : -1;
        }
        for (const panel of panels) {
          const isActive = panel.id === \`panel-\${target}\`;
          panel.classList.toggle('active', isActive);
          panel.hidden = !isActive;
        }
        if (shouldFocus) tab.focus();
      }
      for (const tab of tabs) {
        tab.addEventListener('click', () => activateTab(tab, false));
        tab.addEventListener('keydown', (event) => {
          const currentIndex = tabs.indexOf(tab);
          let nextIndex = currentIndex;
          if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
          if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
          if (event.key === 'Home') nextIndex = 0;
          if (event.key === 'End') nextIndex = tabs.length - 1;
          if (nextIndex !== currentIndex) {
            event.preventDefault();
            activateTab(tabs[nextIndex]);
          }
        });
      }
    </script>
  </body>
</html>`;
}

execFileSync(process.execPath, [validateLedgerScript], { stdio: 'inherit' });
const ledger = await readLedger();
await writeText(dashboardPath, render(ledger));
console.log(`Dashboard written to ${repoRelative(dashboardPath)}`);
