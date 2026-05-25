import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dashboardPath,
  escapeHtml,
  gitValue,
  readJson,
  repoRelative,
  repoRoot,
  reviewerBundlePath,
  writeText,
} from './ledger-utils.mjs';
import { evidenceBundleRequiredFiles } from './required-artifacts.mjs';
import { securityFindingsPath, securityReportPath } from './render-dashboard.mjs';

const scriptPath = fileURLToPath(import.meta.url);

const requiredFiles = evidenceBundleRequiredFiles;

function redactPublicText(text) {
  return text
    .replaceAll(repoRoot, '[repo-root]')
    .replaceAll('/Users/michaelhabermas', '[user-home]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .replace(/session_id=[^"'\s;]+/gi, 'session_id=[redacted]')
    .replace(/postgres(?:ql)?:\/\/[^"'\s]+:[^"'\s]+@/gi, 'postgresql://[redacted]:[redacted]@')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted private key]');
}

function redactionFindings(path, text) {
  const findings = [];
  const checks = [
    [/\/Users\/[^"'\s]+/g, 'absolute user path'],
    [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'bearer token'],
    [/session_id=(?!\[redacted\])[^"'\s;]+/gi, 'session cookie'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'private key'],
    [/postgres(?:ql)?:\/\/(?!\[redacted\]:\[redacted\]@)[^"'\s]+:[^"'\s]+@/gi, 'database URL with password'],
  ];
  for (const [pattern, label] of checks) {
    if (pattern.test(text)) findings.push(`${repoRelative(path)} contains ${label}`);
  }
  return findings;
}

async function readRedactedSource(repoPath) {
  const absolutePath = resolve(repoRoot, repoPath);
  const raw = await readFile(absolutePath, 'utf8');
  return redactPublicText(raw);
}

async function writeBundleFile(repoPath, text, includedArtifacts) {
  const outputPath = resolve(reviewerBundlePath, repoPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeText(outputPath, text);
  includedArtifacts.push(repoPath);
}

async function copyDashboardLinkedTestResults(includedArtifacts) {
  const dashboardText = await readFile(dashboardPath, 'utf8');
  const paths = new Set();
  for (const match of dashboardText.matchAll(/href="\.\.\/(test-results\/[^"]+)"/g)) {
    paths.add(match[1]);
  }
  for (const repoPath of paths) {
    const source = resolve(repoRoot, repoPath);
    try {
      await cp(source, resolve(reviewerBundlePath, repoPath), {
        recursive: true,
        force: true,
        filter: (path) => !path.includes('/.DS_Store'),
      });
      includedArtifacts.push(repoPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function listTextFiles(root) {
  const entries = [];
  async function visit(path) {
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const entry of await readdir(path)) {
        await visit(join(path, entry));
      }
      return;
    }
    if (info.size > 1_000_000) return;
    if (/\.(png|jpg|jpeg|gif|webp|zip|pdf|mp4|webm)$/i.test(path)) return;
    entries.push(path);
  }
  await visit(root);
  return entries;
}

async function redactBundleTextFiles() {
  for (const path of await listTextFiles(reviewerBundlePath)) {
    const text = await readFile(path, 'utf8');
    const redacted = redactPublicText(text);
    if (redacted !== text) await writeFile(path, redacted);
  }
}

function renderBundleIndex(manifest) {
  const links = [
    ['Reviewer packet', 'my-docs/reviewer-dashboard.html'],
    ['Submission ledger', 'my-docs/evidence/submission-ledger.json'],
    ['Security latest report', 'my-docs/evidence/security-audit/latest.json'],
    ['Security findings ledger', 'my-docs/evidence/security-audit/security-findings-ledger.md'],
    ['Category 8 source brief', 'my-docs/SOURCE-OF-TRUTH/Shipshape-Security-Audit.txt'],
    ['Improvement report', 'my-docs/IMPROVEMENT_REPORT.md'],
    ['Bundle manifest', 'manifest.json'],
  ];
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ShipShape Reviewer Evidence Bundle</title>
    <style>
      :root { color-scheme: light; --bg:#f6f4ef; --paper:#fffdf8; --ink:#151515; --muted:#66635d; --line:#d8d1c3; --dark:#20201d; }
      * { box-sizing:border-box; }
      body { margin:0; background:var(--bg); color:var(--ink); font-family:"Avenir Next","Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif; line-height:1.5; }
      main { width:min(980px, calc(100vw - 32px)); margin:0 auto; padding:32px 0 48px; }
      section, header { background:var(--paper); border:1px solid var(--line); padding:18px; margin-bottom:14px; }
      h1,h2,p { margin-top:0; }
      h1 { font-size:34px; line-height:1.05; }
      h2 { font-size:20px; }
      p,li { color:var(--muted); }
      code { padding:2px 5px; background:#eee7da; border:1px solid #ded3c0; }
      a { color:inherit; text-decoration:underline; text-underline-offset:2px; }
      ul { display:grid; gap:8px; padding-left:20px; }
      .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
      .metric { border:1px solid var(--line); background:#fbf8f0; padding:10px; }
      .metric strong { display:block; color:var(--dark); font-size:20px; }
      .metric span { color:var(--muted); font-size:12px; font-weight:800; text-transform:uppercase; }
      @media (max-width:720px) { .grid { grid-template-columns:1fr; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <p><strong>Generated reviewer artifact</strong></p>
        <h1>ShipShape reviewer evidence bundle</h1>
        <p>Static bundle for the Week 4 submission. Security wording is scoped: latest active probe results are separate from the known security findings backlog.</p>
      </header>
      <section>
        <h2>Bundle Snapshot</h2>
        <div class="grid">
          <div class="metric"><span>Commit</span><strong>${escapeHtml(manifest.git.commit.slice(0, 12) || 'unknown')}</strong></div>
          <div class="metric"><span>Branch</span><strong>${escapeHtml(manifest.git.branch || 'unknown')}</strong></div>
          <div class="metric"><span>Security run</span><strong>${escapeHtml(manifest.security.runId || 'unknown')}</strong></div>
        </div>
      </section>
      <section>
        <h2>Start Here</h2>
        <ul>${links.map(([label, href]) => `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`).join('')}</ul>
      </section>
      <section>
        <h2>Non-Claims</h2>
        <ul>
          <li>This bundle does not claim remote production penetration testing.</li>
          <li>This bundle does not claim every known security backlog item is closed.</li>
          <li>Dependency CVE status is tied to the included probe/audit run time.</li>
          <li>This is not a FedRAMP, NIST, or third-party pentest certification.</li>
        </ul>
      </section>
      <section>
        <h2>Render Commands</h2>
        <p><code>pnpm submission:validate</code> <code>pnpm submission:render</code> <code>pnpm submission:check</code></p>
      </section>
    </main>
  </body>
</html>`;
}

export async function buildEvidenceBundle() {
  const latest = await readJson(securityReportPath);
  await readJson(securityFindingsPath);
  const includedArtifacts = [];
  const gitStatus = gitValue(['status', '--short']);
  const manifest = {
    schemaVersion: 1,
    bundleGeneratedAt: latest.generatedAt || null,
    generator: repoRelative(scriptPath),
    generatorCommand: 'pnpm submission:render-bundle',
    git: {
      branch: gitValue(['branch', '--show-current']),
      commit: gitValue(['rev-parse', 'HEAD']),
      dirtyWorktree: gitStatus.length > 0,
    },
    security: {
      runId: latest.run?.id || latest.run?.runId || null,
      mode: latest.run?.mode || null,
      apiUrl: latest.run?.apiUrl || null,
      webUrl: latest.run?.webUrl || null,
      latestConfirmedFindings: latest.summary?.findings ?? null,
      triageCounts: latest.summary?.triageCounts || latest.triage?.counts || {},
    },
    sourcePaths: requiredFiles,
    includedArtifacts,
    redaction: {
      localPathsRedacted: true,
      obviousSecretScan: 'passed',
    },
  };

  await rm(reviewerBundlePath, { recursive: true, force: true });
  await mkdir(reviewerBundlePath, { recursive: true });

  for (const repoPath of requiredFiles) {
    await writeBundleFile(repoPath, await readRedactedSource(repoPath), includedArtifacts);
  }
  await copyDashboardLinkedTestResults(includedArtifacts);
  await writeBundleFile('index.html', renderBundleIndex(manifest), includedArtifacts);
  await writeBundleFile('manifest.json', JSON.stringify(manifest, null, 2), includedArtifacts);
  await redactBundleTextFiles();

  const scanFailures = [];
  for (const path of await listTextFiles(reviewerBundlePath)) {
    const text = await readFile(path, 'utf8');
    scanFailures.push(...redactionFindings(path, text));
  }
  if (scanFailures.length > 0) {
    throw new Error(`Evidence bundle redaction check failed:\n${scanFailures.join('\n')}`);
  }

  return { manifest, outputPath: reviewerBundlePath };
}

export { reviewerBundlePath };
