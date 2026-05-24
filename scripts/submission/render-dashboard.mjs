#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  dashboardPath,
  escapeHtml,
  readJson,
  readLedger,
  repoRelative,
  repoRoot,
  sentenceList,
  statusClass,
  statusLabel,
  writeText,
} from './ledger-utils.mjs';
import { resolve } from 'node:path';
import {
  buildLedgerModel,
  dashboardHref,
  formatValue,
  renderMetricSentence,
  renderTargetOutcome,
} from './ledger-projections.mjs';

const validateLedgerScript = fileURLToPath(new URL('./validate-ledger.mjs', import.meta.url));
export const discoveriesPath = resolve(repoRoot, 'my-docs/evidence/discoveries.json');

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
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
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
  return `<a class="path" href="${escapeHtml(href)}" title="${escapeHtml(path)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label || path)}</a>`;
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

function claimDensity(category) {
  const evidence = category.evidence || [];
  const claimCount = (category.claims || []).length;
  const boundaryCount = (category.caveats || []).length + (category.non_claims || []).length;
  const gateCount = (category.acceptance_tests || []).length;
  const artifactCount = evidence.filter((item) => item.path).length;
  const manualCount = evidence.filter((item) => item.type === 'manual_observation').length;
  const score =
    claimCount * 2 +
    boundaryCount * 2 +
    artifactCount +
    gateCount +
    manualCount * 2;
  const level = score >= 18 ? 'high' : score >= 12 ? 'medium' : 'low';
  return {
    artifactCount,
    boundaryCount,
    claimCount,
    gateCount,
    level,
    manualCount,
    score,
    text: `${level[0].toUpperCase()}${level.slice(1)} defense load`,
  };
}

function defenseLoadReceipt(category, mode = 'compact') {
  const density = claimDensity(category);
  const details = `${density.score} pts · ${density.claimCount} claim${density.claimCount === 1 ? '' : 's'} · ${
    density.boundaryCount
  } boundaries · ${density.artifactCount} artifacts · ${density.gateCount} gates${
    density.manualCount > 0 ? ` · ${density.manualCount} manual` : ''
  }`;
  const meaning =
    density.level === 'high'
      ? 'Proven, but review the boundary language and artifact chain before repeating the claim.'
      : density.level === 'medium'
        ? 'Proven, with enough supporting structure that the boundary should be checked.'
        : 'Proven with a comparatively simple evidence path.';
  return `
    <div class="defense-load defense-load-${escapeHtml(density.level)}">
      <span>${escapeHtml(density.text)}</span>
      <small>${escapeHtml(details)}</small>
      ${mode === 'full' ? `<em>${escapeHtml(meaning)}</em>` : ''}
    </div>`;
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
        <article id="overview-${escapeHtml(category.id)}" class="score-card" data-ledger-id="${escapeHtml(category.id)}">
          <header><span class="cat-id">Cat ${category.number}</span>${badge(category.status)}</header>
          <h3>${escapeHtml(category.title)}</h3>
          <p>${escapeHtml(overviewSignal(category))}</p>
          <div class="score-foot">
            ${defenseLoadReceipt(category)}
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

function discoveryCountForCategory(discoveries, category) {
  const catLabel = `cat ${category.number}`;
  const title = String(category.title || '').toLowerCase();
  return (discoveries.items || []).filter((item) => {
    const area = String(item.area || '').toLowerCase();
    return area === catLabel || area === title;
  }).length;
}

function railMetaLabels(category, discoveries) {
  const density = claimDensity(category);
  const metric = category.primaryTarget?.metric_id
    ? (category.derived_metrics || []).find((item) => item.id === category.primaryTarget.metric_id)
    : null;
  const delta =
    metric?.kind === 'percent_change' && typeof metric.change_percent === 'number'
      ? `${metric.change_percent <= 0 ? '-' : '+'}${formatValue(Math.abs(metric.change_percent))}%`
      : `${category.passedTests.length}/${category.acceptance_tests.length}`;
  const artifactCount = (category.evidence || []).filter((item) => item.path).length;
  const boundaryCount = (category.caveats || []).length + (category.non_claims || []).length;
  const discoveryCount = discoveryCountForCategory(discoveries, category);
  const load = density.level[0].toUpperCase();
  return {
    overview: { compact: delta, detail: `${load} · ${delta}` },
    evidence: { compact: `${artifactCount} art`, detail: `${load} · ${artifactCount} artifacts` },
    crossExamine: { compact: `${density.score} pts`, detail: `${load} · ${density.score} pts` },
    claimDiff: { compact: 'diff', detail: `${load} · before -> after` },
    targets: { compact: `${category.passedTests.length}/${category.acceptance_tests.length}`, detail: `${load} · ${category.passedTests.length}/${category.acceptance_tests.length} gates` },
    rubric: { compact: `${category.rubric_items.length} rub`, detail: `${load} · ${category.rubric_items.length} rubric` },
    boundaries: { compact: `${boundaryCount} lim`, detail: `${load} · ${boundaryCount} limits` },
    discoveries: { compact: `${discoveryCount} find`, detail: `${load} · ${discoveryCount} findings` },
  };
}

function categoryRail(categories, discoveries) {
  return `
    <aside class="category-rail" aria-label="Category navigation">
      ${categories
        .map((category) => {
          const density = claimDensity(category);
          const meta = railMetaLabels(category, discoveries);
          const shortTitle = category.title
            .replace('Database Query Efficiency', 'Database')
            .replace('Test Coverage and Quality', 'Tests')
            .replace('Runtime Error and Edge Case Handling', 'Runtime')
            .replace('Accessibility Compliance', 'A11y')
            .replace('Security Audit', 'Security')
            .replace('API Response Time', 'API')
            .replace('Bundle Size', 'Bundle')
            .replace('Type Safety', 'Types');
          return `
            <button class="rail-cell rail-${escapeHtml(density.level)}" type="button" data-category-id="${escapeHtml(
              category.id
            )}" data-meta-overview="${escapeHtml(meta.overview.compact)}" data-detail-overview="${escapeHtml(
              meta.overview.detail
            )}" data-meta-evidence="${escapeHtml(meta.evidence.compact)}" data-detail-evidence="${escapeHtml(
              meta.evidence.detail
            )}" data-meta-cross-examine="${escapeHtml(meta.crossExamine.compact)}" data-detail-cross-examine="${escapeHtml(
              meta.crossExamine.detail
            )}" data-meta-claim-diff="${escapeHtml(meta.claimDiff.compact)}" data-detail-claim-diff="${escapeHtml(
              meta.claimDiff.detail
            )}" data-meta-targets="${escapeHtml(meta.targets.compact)}" data-detail-targets="${escapeHtml(
              meta.targets.detail
            )}" data-meta-rubric="${escapeHtml(meta.rubric.compact)}" data-detail-rubric="${escapeHtml(
              meta.rubric.detail
            )}" data-meta-boundaries="${escapeHtml(meta.boundaries.compact)}" data-detail-boundaries="${escapeHtml(
              meta.boundaries.detail
            )}" data-meta-discoveries="${escapeHtml(meta.discoveries.compact)}" data-detail-discoveries="${escapeHtml(
              meta.discoveries.detail
            )}" aria-label="Jump to Cat ${category.number}: ${escapeHtml(category.title)}">
              <span class="rail-number">${category.number}</span>
              <span class="rail-load">${escapeHtml(density.level[0].toUpperCase())}</span>
              <span class="rail-delta">${escapeHtml(meta.overview.compact)}</span>
              <span class="rail-title">Cat ${category.number} · ${escapeHtml(shortTitle)}</span>
              <span class="rail-meta">${escapeHtml(category.title)}</span>
              <span class="rail-detail">${escapeHtml(meta.overview.detail)}</span>
            </button>`;
        })
        .join('')}
    </aside>`;
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
      const sourceSummary = `<div class="source-links">${category.sources
        .map((source) => linkedPath(source))
        .join('')}</div>`;
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

function discoveryStatusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'fixed' || normalized === 'proven') return 'pass';
  if (normalized === 'watch' || normalized === 'deferred') return 'warn';
  if (normalized === 'rejected') return 'fail';
  return '';
}

function discoveryRows(discoveries) {
  return (discoveries.items || [])
    .map((item, index) => {
      const statusClassName = discoveryStatusClass(item.status);
      const impact = Number.isFinite(Number(item.impact)) ? Number(item.impact) : 3;
      return `
        <tr data-index="${index + 1}" data-impact="${impact}" data-area="${escapeHtml(item.area)}" data-type="${escapeHtml(
          item.type
        )}" data-status="${escapeHtml(item.status)}">
          <td class="disc-index">${String(index + 1).padStart(2, '0')}</td>
          <td><span class="impact-pill impact-${impact}">${impact}</span></td>
          <td><span class="disc-area">${escapeHtml(item.area)}</span></td>
          <td>${escapeHtml(item.type)}</td>
          <td><strong>${escapeHtml(item.title)}</strong></td>
          <td>${escapeHtml(item.note)}</td>
          <td><span class="test-chip ${escapeHtml(statusClassName)}">${escapeHtml(item.status)}</span></td>
          <td>${linkedPath(item.evidence, shortPath(item.evidence))}</td>
        </tr>`;
    })
    .join('');
}

function discoverySummary(discoveries) {
  const counts = new Map();
  for (const item of discoveries.items || []) {
    counts.set(item.status, (counts.get(item.status) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, count]) => `<span class="test-chip ${escapeHtml(discoveryStatusClass(status))}">${escapeHtml(status)} ${count}</span>`)
    .join(' ');
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

function findSummaryCard(category, title) {
  return (category.summary_cards || []).find((card) => String(card.title || '').toLowerCase() === title);
}

function summaryCardSentence(card) {
  if (!card?.items?.length) return '';
  return card.items.map((item) => `${item.label}: ${item.value}`).join(' ');
}

function reviewerMeaning(category) {
  const claim = category.primaryClaim || category.claims?.[0];
  const nonClaim = category.non_claims?.[0];
  const caveat = category.caveats?.[0];
  if (nonClaim) return `${claim?.statement || overviewSignal(category)} Boundary: ${nonClaim}`;
  if (caveat) return `${claim?.statement || overviewSignal(category)} Caveat: ${caveat}`;
  return claim?.statement || category.proofSummary || overviewSignal(category);
}

function claimDiffCards(categories) {
  return categories
    .map((category) => {
      const baseline = findSummaryCard(category, 'audit baseline');
      const closeout = findSummaryCard(category, 'closeout proof');
      return `
        <article class="diff-card" data-ledger-id="${escapeHtml(category.id)}">
          <div class="diff-head">
            <div>
              <p class="eyebrow">Cat ${category.number} Diff</p>
              <h2>${escapeHtml(category.title)}</h2>
            </div>
            ${badge(category.status)}
          </div>
          <div class="diff-lanes">
            <section>
              <h3>Before</h3>
              <p>${escapeHtml(summaryCardSentence(baseline) || category.source_requirement.statement)}</p>
            </section>
            <section>
              <h3>After</h3>
              <p>${escapeHtml(summaryCardSentence(closeout) || category.proofSummary || overviewSignal(category))}</p>
            </section>
            <section>
              <h3>Reviewer Meaning</h3>
              <p>${escapeHtml(reviewerMeaning(category))}</p>
            </section>
          </div>
        </article>`;
    })
    .join('');
}

function firstCommandEvidence(category) {
  return (category.evidence || []).find((item) => item.command) || null;
}

function firstArtifactEvidence(category) {
  return (category.evidence || []).find((item) => item.path) || null;
}

function attackLine(category) {
  const caveat = category.caveats?.[0];
  const nonClaim = category.non_claims?.[0];
  if (category.status !== 'proven') return 'What proof is still missing before this can be claimed?';
  if (nonClaim) return `Does this overreach into the non-claim: ${nonClaim.replace(/\.$/, '')}?`;
  if (caveat) return `Does this caveat weaken the claim: ${caveat.replace(/\.$/, '')}?`;
  return 'What would a reviewer challenge first?';
}

function defenseLine(category) {
  const claim = category.primaryClaim || category.claims?.[0];
  const tests = category.acceptance_tests || [];
  const passedCount = tests.filter((test) => test.result === 'pass').length;
  const caveat = category.caveats?.[0];
  const nonClaim = category.non_claims?.[0];
  const scope = nonClaim || caveat;
  const gate = tests.length ? `${passedCount}/${tests.length} acceptance gates pass` : 'No acceptance gates recorded';
  if (!claim) return `${gate}; use the source requirement and evidence list before making a stronger claim.`;
  return `${gate}. ${claim.statement}${scope ? ` Boundary: ${scope}` : ''}`;
}

function sourceRequirementLine(category) {
  return `${category.source_requirement.statement} Source: ${category.source_requirement.source}`;
}

function crossExamineCards(categories) {
  return categories
    .map((category) => {
      const claim = category.primaryClaim || category.claims?.[0];
      const artifact = firstArtifactEvidence(category);
      const command = firstCommandEvidence(category);
      const proof = category.primaryTarget
        ? `${category.primaryTarget.description} ${renderTargetOutcome(category, category.primaryTarget)}`
        : category.proofSummary || overviewSignal(category);
      return `
        <article class="cross-card" data-ledger-id="${escapeHtml(category.id)}">
          <div class="cross-card-head">
            <div>
              <p class="eyebrow">Cross-Examine Cat ${category.number}</p>
              <h2>${escapeHtml(category.title)}</h2>
              ${defenseLoadReceipt(category, 'full')}
            </div>
            ${badge(category.status)}
          </div>
          <dl class="cross-list">
            <div>
              <dt>Claim</dt>
              <dd>${escapeHtml(claim?.statement || overviewSignal(category))}</dd>
            </div>
            <div>
              <dt>Attack</dt>
              <dd>${escapeHtml(attackLine(category))}</dd>
            </div>
            <div>
              <dt>Defense</dt>
              <dd>${escapeHtml(defenseLine(category))}</dd>
            </div>
            <div>
              <dt>Source Gate</dt>
              <dd>${escapeHtml(sourceRequirementLine(category))}</dd>
            </div>
            <div>
              <dt>Proof Hook</dt>
              <dd>${escapeHtml(proof)}</dd>
            </div>
            <div>
              <dt>Reproduce</dt>
              <dd>${command ? `${code(command.command)} <span>${escapeHtml(command.result ? `Result: ${command.result}` : command.description || '')}</span>` : '<span>No command evidence recorded.</span>'}</dd>
            </div>
            <div>
              <dt>Artifact</dt>
              <dd>${artifact ? `${linkedPath(artifact.path, shortPath(artifact.path))} <span>${escapeHtml(artifact.description || '')}</span>` : '<span>No artifact path recorded.</span>'}</dd>
            </div>
          </dl>
        </article>`;
    })
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

export function renderDashboard(ledger, discoveries = { items: [] }) {
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
      .page { width:min(1260px, calc(100vw - 32px)); margin:0 auto; padding:20px 0 44px; }
      .dashboard-shell { display:grid; grid-template-columns:74px minmax(0,1fr); gap:14px; align-items:start; }
      .dashboard-content { min-width:0; }
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
      .category-rail { position:sticky; top:8px; z-index:11; display:grid; gap:6px; padding:8px; background:color-mix(in srgb, var(--bg) 93%, transparent); backdrop-filter:blur(8px); border:1px solid var(--line); }
      .rail-cell { appearance:none; position:relative; display:grid; grid-template-columns:1fr 1fr; gap:4px 6px; align-items:center; min-height:66px; width:56px; padding:7px 8px; border:1px solid var(--line); background:var(--paper); color:var(--dark); font:inherit; cursor:pointer; text-align:left; transition:width .16s ease, border-color .16s ease, box-shadow .16s ease; }
      .rail-cell:hover { width:230px; z-index:12; border-color:var(--dark); box-shadow:0 8px 20px rgba(32,32,29,.12); }
      .rail-cell:hover { grid-template-columns:minmax(0,1fr); }
      .rail-cell:focus-visible { outline:2px solid var(--dark); outline-offset:2px; }
      .rail-number { grid-column:1; font-size:15px; font-weight:950; line-height:1; }
      .rail-load { grid-column:2; color:var(--muted); font-size:11px; font-weight:950; line-height:1; text-align:right; white-space:nowrap; }
      .rail-delta { grid-column:1 / -1; display:block; min-width:0; color:var(--muted); font-size:10px; font-weight:850; line-height:1; text-align:left; white-space:nowrap; }
      .rail-title,.rail-meta,.rail-detail { grid-column:1 / -1; display:none; min-width:0; white-space:normal; overflow:visible; text-overflow:clip; }
      .rail-title { font-size:13px; font-weight:950; line-height:1.15; }
      .rail-meta { color:#34342f; font-size:12px; font-weight:800; line-height:1.2; }
      .rail-detail { color:var(--muted); font-size:11px; font-weight:750; line-height:1.2; }
      .rail-cell:hover .rail-title,.rail-cell:hover .rail-meta,.rail-cell:hover .rail-detail { display:block; }
      .rail-cell:hover .rail-number,.rail-cell:hover .rail-load,.rail-cell:hover .rail-delta { display:none; }
      .rail-low { border-left:4px solid #b6d6b2; }
      .rail-medium { border-left:4px solid #e2c77f; }
      .rail-high { border-left:4px solid #e0aaa4; }
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
      .defense-load { display:grid; gap:3px; padding:6px 7px; border:1px solid var(--line); background:#fbf8f0; color:var(--muted); font-size:11px; line-height:1.25; }
      .defense-load span { color:var(--dark); font-weight:900; text-transform:capitalize; }
      .defense-load small { color:var(--muted); font-size:11px; font-weight:750; }
      .defense-load em { color:#34342f; font-size:12px; font-style:normal; font-weight:650; }
      .defense-load-low { border-color:#b6d6b2; background:var(--proven-bg); }
      .defense-load-medium { border-color:#e2c77f; background:var(--partial-bg); }
      .defense-load-high { border-color:#e0aaa4; background:var(--open-bg); }
      .diff-grid { display:grid; gap:10px; }
      .diff-card { padding:13px; border:1px solid var(--line); background:var(--paper); }
      .diff-head { display:flex; gap:8px; justify-content:space-between; align-items:flex-start; margin-bottom:10px; }
      .diff-head h2 { margin-bottom:0; font-size:19px; }
      .diff-lanes { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
      .diff-lanes section { padding:10px; border:1px solid var(--line); background:#fbf8f0; }
      .diff-lanes h3 { margin-bottom:6px; color:var(--muted); font-size:11px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; }
      .diff-lanes p { margin-bottom:0; color:#2d2d29; font-size:13px; }
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
      .discoveries-table .test-chip { min-width:70px; justify-content:center; white-space:nowrap; }
      .disc-area { display:inline-flex; align-items:center; min-height:22px; padding:3px 7px; border:1px solid var(--line); background:#fbf8f0; font-size:11px; font-weight:850; white-space:nowrap; }
      .disc-index { color:var(--muted); font-size:11px; font-weight:850; white-space:nowrap; }
      .impact-pill { display:inline-flex; align-items:center; justify-content:center; width:24px; min-height:22px; border:1px solid var(--line); background:#fbf8f0; font-size:11px; font-weight:900; }
      .impact-5 { color:var(--open-ink); border-color:#e0aaa4; background:var(--open-bg); }
      .impact-4 { color:var(--partial-ink); border-color:#e2c77f; background:var(--partial-bg); }
      .discovery-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:10px; }
      .discovery-head p { max-width:760px; margin-bottom:0; font-size:13px; }
      .sort-button { appearance:none; display:inline-flex; align-items:center; gap:4px; padding:0; border:0; background:transparent; color:inherit; font:inherit; font-size:inherit; font-weight:inherit; letter-spacing:inherit; line-height:inherit; text-align:left; text-transform:inherit; cursor:pointer; }
      .sort-button:hover { color:var(--dark); }
      .sort-button::after { content:""; opacity:.65; font-size:10px; }
      .sort-button[data-dir="asc"]::after { content:"↑"; }
      .sort-button[data-dir="desc"]::after { content:"↓"; }
      .artifact-link { margin-top:5px; }
      .path { font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace; font-size:12px; }
      .table-wrap td .path { display:block; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; overflow-wrap:normal; word-break:normal; }
      .source-links { display:grid; gap:2px; align-content:start; }
      .source-links .path { line-height:1.15; }
      .non-claim-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
      .non-claim-card { padding:12px; border:1px solid var(--line); background:#fbf8f0; }
      .non-claim-card h3 { margin-bottom:7px; font-size:14px; }
      .non-claim-card ul { margin:0; padding-left:18px; color:var(--muted); font-size:13px; }
      .non-claim-card li + li { margin-top:4px; }
      .cross-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
      .cross-card { padding:13px; border:1px solid var(--line); background:var(--paper); }
      .cross-card-head { display:flex; gap:8px; justify-content:space-between; align-items:flex-start; margin-bottom:10px; }
      .cross-card-head h2 { margin-bottom:0; font-size:19px; }
      .cross-card-head .defense-load { margin-top:7px; max-width:430px; }
      .cross-list { display:grid; gap:7px; margin:0; }
      .cross-list div { padding:8px 9px; border:1px solid var(--line); background:#fbf8f0; }
      .cross-list dt { margin-bottom:3px; color:var(--muted); font-size:10px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; }
      .cross-list dd { margin:0; color:#2d2d29; font-size:13px; }
      .cross-list dd span { display:block; margin-top:4px; color:var(--muted); }
      .table-wrap { overflow-x:auto; }
      table { width:100%; min-width:760px; border-collapse:collapse; font-size:13px; }
      th,td { padding:10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
      th { color:var(--muted); font-size:11px; font-weight:850; letter-spacing:.08em; text-transform:uppercase; }
      tr:last-child td { border-bottom:0; }
      .evidence-summary-table { table-layout:fixed; }
      .evidence-summary-table th:nth-child(1),.evidence-summary-table td:nth-child(1) { width:110px; }
      .evidence-summary-table th:nth-child(2),.evidence-summary-table td:nth-child(2) { width:76px; }
      .evidence-summary-table th:nth-child(5),.evidence-summary-table td:nth-child(5) { width:160px; }
      .rubric-table { table-layout:fixed; min-width:900px; }
      .rubric-table th:nth-child(1),.rubric-table td:nth-child(1) { width:64px; }
      .rubric-table th:nth-child(2),.rubric-table td:nth-child(2) { width:330px; }
      .rubric-table th:nth-child(3),.rubric-table td:nth-child(3) { width:90px; }
      .rubric-table th:nth-child(4),.rubric-table td:nth-child(4) { width:104px; }
      .rubric-table th:nth-child(5),.rubric-table td:nth-child(5) { width:280px; }
      .rubric-table td:nth-child(2),.rubric-table td:nth-child(5) { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .discoveries-table { table-layout:fixed; min-width:1060px; }
      .discoveries-table th:nth-child(1),.discoveries-table td:nth-child(1) { width:42px; }
      .discoveries-table th:nth-child(2),.discoveries-table td:nth-child(2) { width:58px; }
      .discoveries-table th:nth-child(3),.discoveries-table td:nth-child(3) { width:88px; }
      .discoveries-table th:nth-child(4),.discoveries-table td:nth-child(4) { width:112px; }
      .discoveries-table th:nth-child(7),.discoveries-table td:nth-child(7) { width:96px; }
      .discoveries-table th:nth-child(8),.discoveries-table td:nth-child(8) { width:150px; }
      .discoveries-table td:nth-child(1),.discoveries-table td:nth-child(2),.discoveries-table td:nth-child(3),.discoveries-table td:nth-child(4),.discoveries-table td:nth-child(7),.discoveries-table td:nth-child(8) { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .discoveries-table td:nth-child(8) .path { line-height:1.15; }
      code { padding:2px 5px; background:#eee7da; border:1px solid #ded3c0; font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace; font-size:.92em; }
      .footer { margin-top:28px; padding-top:18px; border-top:1px solid var(--line); color:var(--muted); font-size:13px; }
      .status-row { margin-bottom:10px; }
      @media (max-width: 1100px) { .score-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
      @media (max-width: 960px) { .dashboard-shell { grid-template-columns:1fr; } .category-rail { top:47px; display:flex; overflow-x:auto; margin:-8px 0 10px; } .rail-cell,.rail-cell:hover,.rail-cell:focus-visible { flex:0 0 138px; width:138px; } .rail-title,.rail-meta { display:block; } .hero,.section-grid,.mini-grid,.non-claim-grid,.cross-grid,.diff-lanes { grid-template-columns:1fr; } .hero-side .score-grid,.score-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .span-4,.span-6,.span-8,.span-12 { grid-column:auto; } }
      @media (max-width: 620px) { .page { width:min(100% - 20px,1240px); padding-top:14px; } .hero-main,.hero-side,.panel,.callout { padding:14px; } .verdict-row { grid-template-columns:1fr; } .cat-chip-row { justify-content:flex-start; } .tabs { margin-left:-10px; margin-right:-10px; padding-left:10px; padding-right:10px; } table { min-width:680px; } }
    </style>
  </head>
  <body>
    <main class="page">
      <div class="dashboard-shell">
      ${categoryRail(categories, discoveries)}
      <div class="dashboard-content">
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
        <button class="tab" id="tab-cross-examine" role="tab" aria-selected="false" aria-controls="panel-cross-examine" tabindex="-1" data-tab="cross-examine">Cross-Examine</button>
        <button class="tab" id="tab-claim-diff" role="tab" aria-selected="false" aria-controls="panel-claim-diff" tabindex="-1" data-tab="claim-diff">Claim Diff</button>
        <button class="tab" id="tab-targets" role="tab" aria-selected="false" aria-controls="panel-targets" tabindex="-1" data-tab="targets">Targets</button>
        <button class="tab" id="tab-rubric" role="tab" aria-selected="false" aria-controls="panel-rubric" tabindex="-1" data-tab="rubric">Rubric</button>
        <button class="tab" id="tab-boundaries" role="tab" aria-selected="false" aria-controls="panel-boundaries" tabindex="-1" data-tab="boundaries">Boundaries</button>
        <button class="tab" id="tab-discoveries" role="tab" aria-selected="false" aria-controls="panel-discoveries" tabindex="-1" data-tab="discoveries">Discoveries</button>
      </nav>

      <section id="panel-overview" class="tab-panel active" role="tabpanel" aria-labelledby="tab-overview" tabindex="0">
        <div class="section-grid">
          <div class="span-12"><div class="score-grid">${metricCards(categories)}</div></div>
        </div>
      </section>

      <section id="panel-evidence" class="tab-panel" role="tabpanel" aria-labelledby="tab-evidence" tabindex="0" hidden>
        <div class="section-grid">${categorySections(categories)}</div>
        <div class="table-wrap"><table class="evidence-summary-table"><thead><tr><th>Category</th><th>Status</th><th>Proof Summary</th><th>Acceptance Tests</th><th>Sources</th></tr></thead><tbody>${evidenceRows(categories)}</tbody></table></div>
      </section>

      <section id="panel-cross-examine" class="tab-panel" role="tabpanel" aria-labelledby="tab-cross-examine" tabindex="0" hidden>
        <article class="panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Reviewer Defense Packets</p>
              <h2>Cross-Examine</h2>
            </div>
            <span class="subtle">Claim -> attack -> defense -> proof</span>
          </div>
          <div class="cross-grid">${crossExamineCards(categories)}</div>
        </article>
      </section>

      <section id="panel-claim-diff" class="tab-panel" role="tabpanel" aria-labelledby="tab-claim-diff" tabindex="0" hidden>
        <article class="panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Before / After / Meaning</p>
              <h2>Claim Diff</h2>
            </div>
            <span class="subtle">Derived from baseline and closeout cards</span>
          </div>
          <div class="diff-grid">${claimDiffCards(categories)}</div>
        </article>
      </section>

      <section id="panel-targets" class="tab-panel" role="tabpanel" aria-labelledby="tab-targets" tabindex="0" hidden>
        <div class="table-wrap"><table><thead><tr><th>Category</th><th>Target</th><th>Description</th><th>Operator</th><th>Threshold</th><th>Actual</th><th>Result</th></tr></thead><tbody>${targetRows(categories)}</tbody></table></div>
      </section>

      <section id="panel-rubric" class="tab-panel" role="tabpanel" aria-labelledby="tab-rubric" tabindex="0" hidden>
        <div class="table-wrap"><table class="rubric-table"><thead><tr><th>Category</th><th>Rubric Item</th><th>Phase</th><th>Status</th><th>Ledger Location</th></tr></thead><tbody>${rubricRows(categories)}</tbody></table></div>
      </section>

      <section id="panel-boundaries" class="tab-panel" role="tabpanel" aria-labelledby="tab-boundaries" tabindex="0" hidden>
        <article class="panel">
          <h2>Explicit Non-Claims</h2>
          <div class="non-claim-grid">${nonClaimItems(categories)}</div>
        </article>
      </section>

      <section id="panel-discoveries" class="tab-panel" role="tabpanel" aria-labelledby="tab-discoveries" tabindex="0" hidden>
        <article class="panel">
          <div class="discovery-head">
            <div>
              <p class="eyebrow">Short Research Log</p>
              <h2>Discoveries</h2>
              <p>Short list of findings, decisions, fixes, and follow-up signals. Full log: ${repoLink('my-docs/discovery-research-log.md', 'discovery-research-log.md')}.</p>
            </div>
            <div class="chip-list">${discoverySummary(discoveries)}</div>
          </div>
          <div class="table-wrap"><table class="discoveries-table"><thead><tr><th><button class="sort-button" type="button" data-sort="index">#</button></th><th><button class="sort-button" type="button" data-sort="impact">Impact</button></th><th><button class="sort-button" type="button" data-sort="area">Area</button></th><th><button class="sort-button" type="button" data-sort="type">Type</button></th><th>Discovery</th><th>Consequence</th><th><button class="sort-button" type="button" data-sort="status">Status</button></th><th>Evidence</th></tr></thead><tbody>${discoveryRows(discoveries)}</tbody></table></div>
        </article>
      </section>

      <footer class="footer">
        Generated from ${code('my-docs/evidence/submission-ledger.json')} using ${code('pnpm submission:render-dashboard')}. Validate with ${code('pnpm submission:validate')}.
      </footer>
      </div>
      </div>
    </main>
    <script>
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
      const railCells = Array.from(document.querySelectorAll('.rail-cell'));
      const activeTabStorageKey = 'ship-submission-dashboard-active-tab';
      function syncRailMeta(tabName) {
        const key = \`meta\${tabName
          .split('-')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join('')}\`;
        for (const cell of railCells) {
          const value = cell.dataset[key] || cell.dataset.metaOverview || '';
          const detailValue = cell.dataset[key.replace('meta', 'detail')] || cell.dataset.detailOverview || value;
          const compact = cell.querySelector('.rail-delta');
          const detail = cell.querySelector('.rail-detail');
          if (compact) compact.textContent = value;
          if (detail) detail.textContent = detailValue;
        }
      }
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
        syncRailMeta(target);
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
      function scrollToDashboardTarget(target) {
        const stickyOffset = (document.querySelector('.tabs')?.getBoundingClientRect().height || 0) + 24;
        const top = target.getBoundingClientRect().top + window.scrollY - stickyOffset;
        window.scrollTo({
          top,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        });
      }
      function jumpToCategory(categoryId) {
        const activePanel = panels.find((panel) => panel.classList.contains('active'));
        const activeTab = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')?.dataset.tab || '';
        if (new Set(['targets', 'rubric', 'discoveries']).has(activeTab)) return;
        const escapedId = CSS.escape(categoryId);
        const target =
          activePanel?.querySelector(\`[data-ledger-id="\${escapedId}"]\`) ||
          document.querySelector(\`[data-ledger-id="\${escapedId}"]\`);
        if (!target) return;
        scrollToDashboardTarget(target);
      }
      for (const cell of railCells) {
        cell.addEventListener('click', () => jumpToCategory(cell.dataset.categoryId));
      }

      const discoveryTable = document.querySelector('.discoveries-table');
      const discoveryRows = discoveryTable ? Array.from(discoveryTable.querySelectorAll('tbody tr')) : [];
      const sortButtons = Array.from(document.querySelectorAll('.sort-button'));
      const discoverySortStorageKey = 'ship-submission-dashboard-discovery-sort';
      let discoverySort = { key: 'impact', dir: 'desc' };
      function loadDiscoverySort() {
        let savedSort = null;
        try {
          savedSort = JSON.parse(localStorage.getItem(discoverySortStorageKey) || 'null');
        } catch {}
        if (!savedSort || typeof savedSort !== 'object') return;
        const keys = new Set(sortButtons.map((button) => button.dataset.sort));
        if (!keys.has(savedSort.key)) return;
        if (savedSort.dir !== 'asc' && savedSort.dir !== 'desc') return;
        discoverySort = { key: savedSort.key, dir: savedSort.dir };
      }
      function saveDiscoverySort() {
        try {
          localStorage.setItem(discoverySortStorageKey, JSON.stringify(discoverySort));
        } catch {}
      }
      function discoveryValue(row, key) {
        if (key === 'index' || key === 'impact') return Number(row.dataset[key] || 0);
        return row.dataset[key] || '';
      }
      function applyDiscoveryControls() {
        const tbody = discoveryTable?.querySelector('tbody');
        if (!tbody) return;
        const rows = [...discoveryRows].sort((a, b) => {
          const left = discoveryValue(a, discoverySort.key);
          const right = discoveryValue(b, discoverySort.key);
          const result =
            typeof left === 'number' && typeof right === 'number'
              ? left - right
              : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
          return discoverySort.dir === 'asc' ? result : -result;
        });
        for (const row of rows) {
          row.hidden = false;
          tbody.appendChild(row);
        }
        for (const button of sortButtons) {
          button.dataset.dir = button.dataset.sort === discoverySort.key ? discoverySort.dir : '';
        }
      }
      for (const button of sortButtons) {
        button.addEventListener('click', () => {
          const key = button.dataset.sort;
          discoverySort = {
            key,
            dir: discoverySort.key === key && discoverySort.dir === 'desc' ? 'asc' : 'desc',
          };
          saveDiscoverySort();
          applyDiscoveryControls();
        });
      }
      loadDiscoverySort();
      applyDiscoveryControls();
    </script>
  </body>
</html>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  execFileSync(process.execPath, [validateLedgerScript], { stdio: 'inherit' });
  const ledger = await readLedger();
  const discoveries = await readJson(discoveriesPath);
  await writeText(dashboardPath, renderDashboard(ledger, discoveries));
  console.log(`Dashboard written to ${repoRelative(dashboardPath)}`);
}
