#!/usr/bin/env node
/**
 * Reproduces AUDIT_REPORT.md appendix [^1] counting (ts/tsx only, audit roots)
 * with per-package breakdown for all four violation kinds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const root = process.cwd();
const auditRoots = ['web/src', 'api/src', 'shared/src', 'e2e'];
const prodRoots = ['web/src', 'api/src', 'shared/src'];

const kinds = [
  { kind: ts.SyntaxKind.AnyKeyword, key: 'any' },
  { kind: ts.SyntaxKind.AsExpression, key: 'type_assertions' },
  { kind: ts.SyntaxKind.NonNullExpression, key: 'non_null_assertions' },
];

const suppressionRe = /@ts-(ignore|expect-error)\b/g;

function collectFiles({ roots, excludeTests }) {
  const excludedDirs = new Set(['dist', 'node_modules', 'coverage', 'test-results', 'playwright-report']);
  if (excludeTests) excludedDirs.add('__tests__');
  const files = [];

  function isTestFile(filePath) {
    return /(^|\/)(test|tests|__tests__)(\/|$)/.test(filePath)
      || /\.(test|spec)\.tsx?$/.test(filePath);
  }

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirs.has(entry.name)) walk(filePath);
      } else if (/\.(ts|tsx)$/.test(entry.name) && (!excludeTests || !isTestFile(filePath))) {
        files.push(filePath);
      }
    }
  }

  for (const sourceRoot of roots) {
    walk(path.join(root, sourceRoot));
  }
  return files;
}

function emptyPackage() {
  return { any: 0, type_assertions: 0, non_null_assertions: 0, ts_suppressions: 0 };
}

function packageFor(file, roots) {
  return roots.find((candidate) => file.startsWith(`${candidate}/`)) || 'other';
}

function countAst(files, roots) {
  const byPackage = Object.fromEntries(roots.map((r) => [r, emptyPackage()]));
  const totals = emptyPackage();

  for (const file of files) {
    const rel = path.relative(root, file);
    const pkg = packageFor(rel, roots);
    if (!byPackage[pkg]) byPackage[pkg] = emptyPackage();

    const text = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    function visit(node) {
      for (const { kind, key } of kinds) {
        if (node.kind === kind) {
          byPackage[pkg][key] += 1;
          totals[key] += 1;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    const suppressions = text.match(suppressionRe);
    const count = suppressions ? suppressions.length : 0;
    byPackage[pkg].ts_suppressions += count;
    totals.ts_suppressions += count;
  }

  for (const pkg of Object.keys(byPackage)) {
    const row = byPackage[pkg];
    row.counted_total =
      row.any + row.type_assertions + row.non_null_assertions + row.ts_suppressions;
  }
  totals.counted_total =
    totals.any + totals.type_assertions + totals.non_null_assertions + totals.ts_suppressions;

  return { byPackage, totals };
}

const auditFiles = collectFiles({ roots: auditRoots, excludeTests: false });
const prodFiles = collectFiles({ roots: prodRoots, excludeTests: true });

const audit = countAst(auditFiles, auditRoots);
const production = countAst(prodFiles, prodRoots);

let gitSha = null;
try {
  gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
} catch {
  gitSha = null;
}

const output = {
  generatedAt: new Date().toISOString(),
  gitSha,
  methodology: 'AUDIT_REPORT.md appendix [^1] (ts/tsx, audit roots, suppression regex [^2])',
  auditScope: audit.totals,
  packageBreakdown: audit.byPackage,
  productionOnly: production.totals,
  productionPackageBreakdown: production.byPackage,
};

console.log(JSON.stringify(output, null, 2));
