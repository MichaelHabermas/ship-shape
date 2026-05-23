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
import {
  buildLedgerModel,
  dashboardHref,
  formatValue,
  renderMetricSentence,
  renderTargetOutcome,
} from './ledger-projections.mjs';

const validateLedgerScript = fileURLToPath(new URL('./validate-ledger.mjs', import.meta.url));

function badge(status) {
  return `<span class="badge ${statusClass(status)}">${escapeHtml(statusLabel(status))}</span>`;
}

function code(value) {
  return `<code>${escapeHtml(value)}</code>`;
}

function resultBadge(result) {
  if (result === 'pass') return badge('proven');
  if (result === 'warn') return badge('partial');
  if (result === 'fail') return badge('open');
  return badge('needs_fill_in');
}

function repoLink(path, label = path) {
  const href = dashboardHref(path);
  if (!href) return code(path);
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function humanizeId(id) {
  return String(id || '')
    .replace(/^cat\d+-/, '')
    .replace(/^cat\d/, '')
    .replace(/-/g, ' ')
    .replace(/\be2e\b/gi, 'E2E')
    .replace(/\bp95\b/gi, 'P95')
    .replace(/\bcve\b/gi, 'CVE')
    .replace(/\bcsrf\b/gi, 'CSRF')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortPath(path) {
  if (!path) return '';
  const parts = path.split('/');
  return parts.length > 3 ? `.../${parts.slice(-3).join('/')}` : path;
}

function linkedPath(path, label = shortPath(path)) {
  const href = dashboardHref(path);
  if (!href) return `<span class="path" title="${escapeHtml(path)}">${escapeHtml(label || path)}</span>`;
  return `<a class="path" href="${escapeHtml(href)}" title="${escapeHtml(path)}">${escapeHtml(label || path)}</a>`;
}

function importantSentence(text) {
  if (!text) return '';
  return String(text).split(/[.;]/)[0].trim();
}

function categoryGateLine(category) {
  const problemCount = category.failedTests.length + category.warningTests.length;
  const result = problemCount === 0 ? 'all gates clear' : `${problemCount} open/warn gate${problemCount === 1 ? '' : 's'}`;
  return `${category.passedTests.length}/${category.acceptance_tests.length} acceptance pass; ${result}`;
}

function firstProblem(category) {
  const test = [...category.failedTests, ...category.warningTests][0];
  if (!test) return null;
  const target = (category.targets || []).find((item) => item.id === test.target_id);
  return { test, target };
}

function blockerLabel(problem) {
  if (!problem) return '';
  if (!problem.target) return humanizeId(problem.test.id);
  const text = problem.target?.description || problem.test.reason || humanizeId(problem.test.id);
  return text
    .replace(/^Provide /i, '')
    .replace(/^At least /i, '')
    .replace(/\.$/, '');
}

function blockerHref(category, problem) {
  if (!problem) return '';
  if (problem.target) return `#target-${problem.target.id}`;
  return `#category-${category.id}`;
}

function overviewSignal(category) {
  const metric = category.primaryTarget?.metric_id
    ? (category.derived_metrics || []).find((item) => item.id === category.primaryTarget.metric_id)
    : null;
  const metricText = renderMetricSentence(metric);
  if (category.status === 'proven' && metricText) return metricText;

  const failedOrWarn = [...category.failedTests, ...category.warningTests];
  if (failedOrWarn.length > 0) {
    const test = failedOrWarn[0];
    const target = (category.targets || []).find((item) => item.id === test.target_id);
    return target?.description || test.reason || humanizeId(test.id);
  }
  if (metricText) return metricText;
  return importantSentence(category.primaryClaim?.statement || category.proofSummary || category.source_requirement.statement);
}

function metricCards(categories) {
  return categories
    .map((category) => {
      const problem = firstProblem(category);
      return `
        <article class="score-card" data-ledger-id="${escapeHtml(category.id)}">
          <header><span class="cat-id">Cat ${category.number}</span>${badge(category.status)}</header>
          <h3>${escapeHtml(category.title)}</h3>
          <p>${escapeHtml(overviewSignal(category))}</p>
          <div class="score-foot">
            <span>${escapeHtml(categoryGateLine(category))}</span>
            ${
              problem
                ? `<a class="blocker-link" href="${escapeHtml(blockerHref(category, problem))}">Missing: ${escapeHtml(blockerLabel(problem))}</a>`
                : ''
            }
          </div>
        </article>`;
    })
    .join('');
}

function categoryOption(category) {
  return `
    <article class="panel span-4 category-card" data-ledger-id="${escapeHtml(category.id)}">
      <p class="eyebrow">Category ${category.number}</p>
      <h2>${escapeHtml(category.title)}</h2>
      <div class="status-row">${badge(category.status)}</div>
      <p>${escapeHtml(category.source_requirement.statement)}</p>
      <div class="mini-grid">
        <div class="mini"><strong>${category.rubric_items.length}</strong><span>rubric items</span></div>
        <div class="mini"><strong>${category.passedTests.length}</strong><span>acceptance pass</span></div>
        <div class="mini"><strong>${category.failedTests.length + category.warningTests.length}</strong><span>fail/warn</span></div>
      </div>
    </article>`;
}

function evidenceRows(categories) {
  return categories
    .map((category) => {
      const testSummary = category.acceptance_tests
        .map(
          (test) =>
            `<span class="test-chip ${escapeHtml(test.result)}" title="${escapeHtml(test.id)}">${escapeHtml(
              test.result.toUpperCase()
            )} ${escapeHtml(humanizeId(test.id))}</span>`
        )
        .join(' ');
      const sourceSummary = category.sources.map((source) => linkedPath(source)).join('<br>');
      return `
        <tr data-ledger-id="${escapeHtml(category.id)}">
          <td>Cat ${category.number}. ${escapeHtml(category.title)}</td>
          <td>${badge(category.status)}</td>
          <td>${escapeHtml(category.proofSummary || '')}</td>
          <td><div class="chip-list">${testSummary}</div></td>
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
          <tr id="target-${escapeHtml(target.id)}" data-ledger-id="${escapeHtml(target.id)}">
            <td>Cat ${category.number}</td>
            <td><span title="${escapeHtml(target.id)}">${escapeHtml(humanizeId(target.id))}</span></td>
            <td>${escapeHtml(target.description)}</td>
            <td>${escapeHtml(target.operator)}</td>
            <td>${escapeHtml(formatValue(target.threshold))}</td>
            <td>${escapeHtml(formatValue(target.actual))}</td>
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
          <tr data-ledger-id="${escapeHtml(item.id)}">
            <td>Cat ${category.number}</td>
            <td><span title="${escapeHtml(item.id)}">${escapeHtml(humanizeId(item.id))}</span></td>
            <td>${escapeHtml(item.phase)}</td>
            <td>${escapeHtml(item.status)}</td>
            <td>${linkedPath(item.location)}</td>
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
        <li data-ledger-id="${escapeHtml(item.id)}">
          <strong>${escapeHtml(humanizeId(item.id))} <span class="subtle">${escapeHtml(item.type)}</span></strong>
          <span>${escapeHtml(item.description || humanizeId(item.id))}</span>
          ${details.length ? `<small>${escapeHtml(details.join(' | '))}</small>` : ''}
          ${item.path ? `<div class="artifact-link">${linkedPath(item.path, 'Open artifact')}</div>` : ''}
        </li>`;
    })
    .join('');
}

function nonClaimItems(categories) {
  return categories
    .filter((category) => category.non_claims.length > 0)
    .map(
      (category) => `
        <article class="non-claim-card" data-ledger-id="${escapeHtml(category.id)}">
          <h3>Cat ${category.number}: ${escapeHtml(category.title)}</h3>
          <ul>
            ${category.non_claims.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </article>`
    )
    .join('');
}

function summaryCards(category) {
  return (category.summary_cards || [])
    .map(
      (card) => `
        <div class="summary-card" data-ledger-id="${escapeHtml(card.id)}">
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
        <article id="category-${escapeHtml(category.id)}" class="panel span-12" data-ledger-id="${escapeHtml(category.id)}">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Category ${category.number}</p>
              <h2>${escapeHtml(category.title)}</h2>
            </div>
            ${badge(category.status)}
          </div>
          <p>${escapeHtml(category.source_requirement.statement)} ${repoLink(category.source_requirement.source, 'Source')}</p>
          ${summaryCards(category)}
          <h3>Targets</h3>
          <ul class="check-list">
            ${(category.targets || [])
              .map(
                (target) => `
                  <li data-ledger-id="${escapeHtml(target.id)}">
                    <strong>${escapeHtml(humanizeId(target.id))} ${resultBadge(target.result)}</strong>
                    <span>${escapeHtml(target.description)} ${escapeHtml(renderTargetOutcome(category, target))}</span>
                  </li>`
              )
              .join('')}
          </ul>
          <h3>Claims</h3>
          <ul class="check-list">
            ${category.claims
              .map(
                (claim) => `
                  <li data-ledger-id="${escapeHtml(claim.id)}">
                    <strong>${escapeHtml(humanizeId(claim.id))} ${badge(claim.status)}</strong>
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

function issueList(items) {
  if (items.length === 0) return '<p>No failing or warning acceptance tests in the current ledger.</p>';
  const grouped = [];
  for (const item of items) {
    const existing = grouped.find((group) => group.categoryNumber === item.categoryNumber);
    if (existing) {
      existing.items.push(item);
    } else {
      grouped.push({
        categoryNumber: item.categoryNumber,
        categoryTitle: item.categoryTitle,
        result: item.result,
        items: [item],
      });
    }
  }
  return `<ul class="gate-list">${grouped
    .map(
      (group) => {
        const primary = group.items[0];
        const title =
          group.items.length === 1
            ? primary.target?.description || humanizeId(primary.id)
            : `${group.categoryTitle} proof gaps (${group.items.length})`;
        const details = group.items
          .slice(0, 2)
          .map((item) => item.reason || item.target?.reason || importantSentence(item.target?.description) || humanizeId(item.id))
          .join(' ');
        const more = group.items.length > 2 ? ` ${group.items.length - 2} more in Targets.` : '';
        return `
        <li data-ledger-id="${escapeHtml(primary.id)}">
          <span class="gate-cat">Cat ${group.categoryNumber}</span>
          <strong title="${escapeHtml(group.items.map((item) => item.id).join(', '))}">${escapeHtml(title)}</strong>
          ${resultBadge(group.result)}
          <span>${escapeHtml(details + more)}</span>
        </li>`
      }
    )
    .join('')}</ul>`;
}

function categoryChips(categories) {
  if (categories.length === 0) return '<span class="verdict-empty">None</span>';
  return categories.map((category) => `<span class="cat-chip">Cat ${category.number}</span>`).join('');
}

function verdictStrip(categories) {
  const claimReady = categories.filter((category) => category.status === 'proven');
  const evidenceBackedBlocked = categories.filter(
    (category) => category.status === 'partial' && category.primaryTarget?.result === 'pass'
  );
  const needsProof = categories.filter(
    (category) => category.status === 'partial' && category.primaryTarget?.result !== 'pass'
  );
  const notReady = categories.filter((category) => category.status !== 'proven' && category.status !== 'partial');

  const rows = [
    {
      label: 'Claim-ready',
      note: 'Safe to lead with.',
      categories: claimReady,
    },
    {
      label: 'Evidence-backed, blocked',
      note: 'Good result, missing required artifact.',
      categories: evidenceBackedBlocked,
    },
    {
      label: 'Needs proof',
      note: 'Useful work, source gate still open.',
      categories: needsProof,
    },
    {
      label: 'Not ready',
      note: 'Placeholder lane.',
      categories: notReady,
    },
  ];

  return `
    <div class="verdict-strip" aria-label="Reviewer verdict map">
      ${rows
        .map(
          (row) => `
            <div class="verdict-row">
              <div>
                <strong>${escapeHtml(row.label)}</strong>
                <span>${escapeHtml(row.note)}</span>
              </div>
              <div class="cat-chip-row">${categoryChips(row.categories)}</div>
            </div>`
        )
        .join('')}
    </div>`;
}

export function renderDashboard(ledger) {
  const model = buildLedgerModel(ledger);
  const categories = model.categories;
  const failedTests = model.failuresAndWarnings.filter((item) => item.result === 'fail');
  const warningTests = model.failuresAndWarnings.filter((item) => item.result === 'warn');

  return `<!doctype html>
<!-- GENERATED FILE: run pnpm submission:render-dashboard. Do not edit by hand. -->
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ShipShape Reviewer Dashboard</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%2320201d'/%3E%3Cpath d='M3 4h10v2H3zm0 3h7v2H3zm0 3h10v2H3z' fill='%23fffdf8'/%3E%3C/svg%3E" />
    <style>
      :root { --bg:#f6f4ef; --paper:#fffdf8; --ink:#151515; --muted:#66635d; --line:#d8d1c3; --dark:#20201d; --proven-bg:#e7f2e5; --proven-ink:#24542a; --partial-bg:#fff3cf; --partial-ink:#73500b; --open-bg:#f7dedc; --open-ink:#7d2f28; --fill-bg:#e9edf3; --fill-ink:#38475d; }
      * { box-sizing: border-box; }
      body { margin:0; background:var(--bg); color:var(--ink); font-family:"Avenir Next","Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif; line-height:1.45; }
      .page { width:min(1180px, calc(100vw - 32px)); margin:0 auto; padding:20px 0 44px; }
      p,li,td,code { overflow-wrap:anywhere; }
      a { color:inherit; text-decoration:underline; text-underline-offset:2px; }
      .hero { display:grid; grid-template-columns:minmax(0,1fr) minmax(340px,.8fr); align-items:stretch; gap:14px; margin-bottom:14px; }
      .hero-main,.hero-side,.panel,.card,.table-wrap,.callout { background:var(--paper); border:1px solid var(--line); }
      .hero-main { padding:18px 20px; min-height:0; display:flex; flex-direction:column; justify-content:space-between; }
      .hero-side,.panel,.callout { padding:14px; }
      .eyebrow { margin:0 0 8px; color:var(--muted); font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
      h1,h2,h3,p { margin-top:0; }
      h1 { max-width:760px; margin-bottom:10px; font-size:clamp(30px,3.5vw,44px); line-height:1.02; letter-spacing:0; }
      h2 { margin-bottom:9px; font-size:24px; line-height:1.15; }
      h3 { margin-bottom:7px; font-size:16px; line-height:1.2; }
      p { color:var(--muted); }
      .lede { max-width:820px; color:#34342f; font-size:15px; }
      .hero-main > p:last-child { margin-bottom:0; font-size:13px; }
      .verdict-strip { display:grid; gap:7px; margin-top:18px; }
      .verdict-row { display:grid; grid-template-columns:minmax(160px,.55fr) minmax(0,1fr); gap:10px; align-items:center; padding:9px 10px; border:1px solid var(--line); background:#fbf8f0; }
      .verdict-row strong { display:block; font-size:13px; line-height:1.2; }
      .verdict-row span { color:var(--muted); font-size:12px; }
      .cat-chip-row { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:5px; }
      .cat-chip { display:inline-flex; align-items:center; min-height:22px; padding:3px 7px; border:1px solid var(--line); background:var(--paper); color:var(--dark); font-size:11px; font-weight:850; white-space:nowrap; }
      .verdict-empty { color:var(--muted); font-size:12px; }
      .badge { display:inline-flex; align-items:center; min-height:22px; padding:3px 8px; border:1px solid transparent; border-radius:999px; font-size:11px; font-weight:800; line-height:1; white-space:nowrap; text-transform:capitalize; }
      .badge.proven { background:var(--proven-bg); border-color:#b6d6b2; color:var(--proven-ink); }
      .badge.partial { background:var(--partial-bg); border-color:#e2c77f; color:var(--partial-ink); }
      .badge.open { background:var(--open-bg); border-color:#e0aaa4; color:var(--open-ink); }
      .badge.fill { background:var(--fill-bg); border-color:#c8d1df; color:var(--fill-ink); }
      .tabs { position:sticky; top:0; z-index:10; display:flex; gap:5px; overflow-x:auto; padding:8px 0; margin:0 0 14px; background:color-mix(in srgb, var(--bg) 93%, transparent); backdrop-filter:blur(8px); border-bottom:1px solid var(--line); }
      .tab { appearance:none; border:1px solid var(--line); background:var(--paper); color:var(--dark); padding:7px 10px; font:inherit; font-size:13px; font-weight:750; cursor:pointer; white-space:nowrap; }
      .tab:hover { border-color:var(--dark); }
      .tab:focus-visible { border-color:var(--dark); outline:2px solid var(--dark); outline-offset:2px; }
      .tab[aria-selected="true"] { background:var(--dark); border-color:var(--dark); color:#fffdf8; }
      .tab-panel { display:none; }
      .tab-panel.active { display:block; }
      .section-grid { display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); gap:12px; margin-bottom:12px; }
      .span-12 { grid-column:span 12; } .span-8 { grid-column:span 8; } .span-6 { grid-column:span 6; } .span-4 { grid-column:span 4; }
      .score-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
      .score-card { min-height:155px; padding:12px; border:1px solid var(--line); background:var(--paper); display:flex; flex-direction:column; gap:8px; }
      .score-card header,.section-heading { display:flex; gap:8px; justify-content:space-between; align-items:flex-start; }
      .score-card p { margin-bottom:0; font-size:13px; }
      .score-foot { display:grid; gap:5px; margin-top:auto; padding-top:8px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; font-weight:700; }
      .blocker-link { color:var(--open-ink); font-weight:850; text-decoration:none; }
      .blocker-link:hover { text-decoration:underline; }
      tr:target { outline:2px solid var(--dark); outline-offset:-2px; background:#fff8df; }
      .cat-id { color:var(--muted); font-size:12px; font-weight:850; letter-spacing:.06em; text-transform:uppercase; }
      .hero-side .score-grid { grid-template-columns:repeat(4,minmax(0,1fr)); margin:9px 0 0; }
      .category-card { display:flex; flex-direction:column; min-height:280px; }
      .category-card .mini-grid { margin-top:auto; }
      .category-card p { margin-bottom:14px; }
      .status-dot { display:flex; align-items:center; gap:5px; min-width:0; font-size:12px; font-weight:800; white-space:nowrap; }
      .status-dot .badge { min-height:18px; padding:2px 6px; font-size:10px; }
      .mini-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:7px; }
      .mini { padding:9px 10px; border:1px solid var(--line); background:#fbf8f0; }
      .mini strong { display:block; font-size:20px; line-height:1.05; }
      .mini span,.check-list span { color:var(--muted); font-size:13px; }
      .subtle { color:var(--muted); font-size:12px; font-weight:700; }
      .summary-card { margin:12px 0; }
      .check-list { display:grid; gap:7px; margin:0; padding:0; list-style:none; }
      .check-list li { padding:10px; border:1px solid var(--line); background:#fbf8f0; }
      .check-list strong { display:block; margin-bottom:3px; }
      .check-list small { display:block; margin-top:5px; color:var(--muted); font-size:12px; }
      .gate-list { display:grid; gap:7px; margin:10px 0 0; padding:0; list-style:none; }
      .gate-list li { display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:6px 8px; align-items:start; padding:7px 8px; border:1px solid var(--line); background:#fbf8f0; }
      .gate-list strong { font-size:13px; line-height:1.25; }
      .gate-list span:last-child { display:none; }
      .gate-cat { color:var(--muted); font-size:11px; font-weight:850; text-transform:uppercase; white-space:nowrap; }
      .chip-list { display:flex; flex-wrap:wrap; gap:5px; }
      .test-chip { display:inline-flex; align-items:center; max-width:100%; padding:3px 6px; border:1px solid var(--line); background:#fbf8f0; color:var(--muted); font-size:11px; font-weight:750; line-height:1.15; }
      .test-chip.pass { color:var(--proven-ink); border-color:#b6d6b2; background:var(--proven-bg); }
      .test-chip.warn { color:var(--partial-ink); border-color:#e2c77f; background:var(--partial-bg); }
      .test-chip.fail { color:var(--open-ink); border-color:#e0aaa4; background:var(--open-bg); }
      .artifact-link { margin-top:5px; }
      .path { font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace; font-size:12px; }
      .non-claim-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
      .non-claim-card { padding:12px; border:1px solid var(--line); background:#fbf8f0; }
      .non-claim-card h3 { margin-bottom:7px; font-size:14px; }
      .non-claim-card ul { margin:0; padding-left:18px; color:var(--muted); font-size:13px; }
      .non-claim-card li + li { margin-top:4px; }
      .table-wrap { overflow-x:auto; }
      table { width:100%; min-width:760px; border-collapse:collapse; font-size:13px; }
      th,td { padding:10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
      th { color:var(--muted); font-size:11px; font-weight:850; letter-spacing:.08em; text-transform:uppercase; }
      tr:last-child td { border-bottom:0; }
      code { padding:2px 5px; background:#eee7da; border:1px solid #ded3c0; font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace; font-size:.92em; }
      .footer { margin-top:28px; padding-top:18px; border-top:1px solid var(--line); color:var(--muted); font-size:13px; }
      .status-row { margin-bottom:10px; }
      @media (max-width: 1100px) { .score-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
      @media (max-width: 960px) { .hero,.section-grid,.mini-grid,.non-claim-grid { grid-template-columns:1fr; } .hero-side .score-grid,.score-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .span-4,.span-6,.span-8,.span-12 { grid-column:auto; } }
      @media (max-width: 620px) { .page { width:min(100% - 20px,1240px); padding-top:14px; } .hero-main,.hero-side,.panel,.callout { padding:14px; } .verdict-row { grid-template-columns:1fr; } .cat-chip-row { justify-content:flex-start; } .tabs { margin-left:-10px; margin-right:-10px; padding-left:10px; padding-right:10px; } table { min-width:680px; } }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero" aria-labelledby="page-title">
        <div class="hero-main">
          <div>
            <p class="eyebrow">Generated From Evidence Ledger</p>
            <h1 id="page-title">ShipShape evidence dashboard</h1>
            <p class="lede">Week 4 reviewer console for source-backed category status, acceptance gates, evidence paths, and explicit non-claims.</p>
          </div>
          ${verdictStrip(categories)}
        </div>
        <aside class="hero-side" aria-label="Current review status">
          <p class="eyebrow">Reviewer Gate Snapshot</p>
          <div class="mini-grid">
            <div class="mini"><strong>${model.gateSnapshot.proven}</strong><span>proven</span></div>
            <div class="mini"><strong>${model.gateSnapshot.partial}</strong><span>partial</span></div>
            <div class="mini"><strong>${model.gateSnapshot.openFill}</strong><span>open/fill</span></div>
          </div>
          <div class="score-grid">${categories
            .map((category) => `<div class="status-dot">${badge(category.status)} <strong>Cat ${category.number}</strong></div>`)
            .join('')}</div>
          ${issueList([...failedTests, ...warningTests])}
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
        </div>
      </section>

      <section id="panel-evidence" class="tab-panel" role="tabpanel" aria-labelledby="tab-evidence" tabindex="0" hidden>
        <div class="section-grid">${categorySections(categories)}</div>
        <div class="table-wrap"><table><thead><tr><th>Category</th><th>Status</th><th>Proof Summary</th><th>Acceptance Tests</th><th>Sources</th></tr></thead><tbody>${evidenceRows(categories)}</tbody></table></div>
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
          <div class="non-claim-grid">${nonClaimItems(categories)}</div>
        </article>
      </section>

      <footer class="footer">
        Generated from ${code('my-docs/evidence/submission-ledger.json')} using ${code('pnpm submission:render-dashboard')}. Validate with ${code('pnpm submission:validate')}.
      </footer>
    </main>
    <script>
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
      const activeTabStorageKey = 'ship-submission-dashboard-active-tab';
      function activateTab(tab, shouldFocus = true, shouldStore = true) {
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
        if (shouldStore) {
          try {
            localStorage.setItem(activeTabStorageKey, target);
          } catch {}
        }
        if (shouldFocus) tab.focus();
      }
      function clearHash() {
        if (!location.hash) return;
        history.replaceState(null, '', location.pathname + location.search);
      }
      for (const tab of tabs) {
        tab.addEventListener('click', () => {
          clearHash();
          activateTab(tab, false);
        });
        tab.addEventListener('keydown', (event) => {
          const currentIndex = tabs.indexOf(tab);
          let nextIndex = currentIndex;
          if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
          if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
          if (event.key === 'Home') nextIndex = 0;
          if (event.key === 'End') nextIndex = tabs.length - 1;
          if (nextIndex !== currentIndex) {
            event.preventDefault();
            clearHash();
            activateTab(tabs[nextIndex]);
          }
        });
      }
      function activateStoredTab() {
        if (location.hash) return;
        let storedTab = '';
        try {
          storedTab = localStorage.getItem(activeTabStorageKey) || '';
        } catch {}
        if (!storedTab) return;
        const tab = tabs.find((item) => item.dataset.tab === storedTab);
        if (!tab) return;
        activateTab(tab, false, false);
      }
      function activateHashTarget() {
        if (!location.hash) return;
        const target = document.getElementById(location.hash.slice(1));
        if (!target) return;
        const panel = target.closest('[role="tabpanel"]');
        if (!panel) return;
        const tab = tabs.find((item) => item.getAttribute('aria-controls') === panel.id);
        if (!tab) return;
        activateTab(tab, false);
        requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }));
      }
      window.addEventListener('hashchange', activateHashTarget);
      activateStoredTab();
      activateHashTarget();
    </script>
  </body>
</html>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  execFileSync(process.execPath, [validateLedgerScript], { stdio: 'inherit' });
  const ledger = await readLedger();
  await writeText(dashboardPath, renderDashboard(ledger));
  console.log(`Dashboard written to ${repoRelative(dashboardPath)}`);
}
