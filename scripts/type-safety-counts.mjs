#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const root = process.cwd();
const roots = ['api/src', 'web/src', 'shared/src', 'e2e'];
const ignoredDirs = new Set(['node_modules', 'dist', 'coverage', 'test-results']);
const sourceFileRe = /\.(tsx?|mts|cts)$/;
const declarationFileRe = /\.d\.ts$/;
const testPathRe = /(^|\/)(__tests__|test|tests|fixtures|mocks|mock|e2e)(\/|$)|\.(test|spec)\.tsx?$/;
const suppressionRe = /@ts-(ignore|expect-error)\b/g;

const countKinds = new Map([
  [ts.SyntaxKind.AnyKeyword, 'any'],
  [ts.SyntaxKind.AsExpression, 'typeAssertions'],
  [ts.SyntaxKind.NonNullExpression, 'nonNullAssertions'],
]);

function walk(dir, files) {
  for (const name of fs.readdirSync(dir)) {
    const filePath = path.join(dir, name);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (!ignoredDirs.has(name)) {
        walk(filePath, files);
      }
      continue;
    }
    if (sourceFileRe.test(name) && !declarationFileRe.test(name)) {
      files.push(filePath);
    }
  }
}

function createEmptyCounts() {
  return {
    any: 0,
    typeAssertions: 0,
    nonNullAssertions: 0,
    tsSuppressions: 0,
  };
}

function sumCounts(counts) {
  return counts.any + counts.typeAssertions + counts.nonNullAssertions + counts.tsSuppressions;
}

function classifyNonNull(sourceFile, node) {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node) return 'chain-base';
  if (ts.isElementAccessExpression(parent) && parent.expression === node) return 'index-base';
  if (ts.isCallExpression(parent) && parent.expression === node) return 'call-target';
  if (ts.isCallExpression(parent) && parent.arguments.includes(node)) return 'call-arg';
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) return 'var-init';
  if (ts.isReturnStatement(parent)) return 'return';
  return 'other';
}

function lineAndColumn(sourceFile, node) {
  const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: pos.line + 1, column: pos.character + 1 };
}

function snippet(sourceFile, node) {
  const text = sourceFile.text.slice(node.getStart(sourceFile), node.getEnd()).replace(/\s+/g, ' ');
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function getGitSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function packageRootFor(relPath) {
  const match = roots.find((candidate) => relPath === candidate || relPath.startsWith(`${candidate}/`));
  return match ?? 'other';
}

function countFile(filePath, totals, productionTotals, byPackage, fileRows) {
  const relPath = path.relative(root, filePath);
  const isProduction = !testPathRe.test(relPath);
  const packageRoot = packageRootFor(relPath);
  if (!byPackage[packageRoot]) {
    byPackage[packageRoot] = createEmptyCounts();
  }
  const text = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const fileCounts = createEmptyCounts();
  const nonNullSamples = [];

  function visit(node) {
    const key = countKinds.get(node.kind);
    if (key) {
      fileCounts[key] += 1;
      if (key === 'nonNullAssertions') {
        nonNullSamples.push({
          ...lineAndColumn(sourceFile, node),
          kind: classifyNonNull(sourceFile, node),
          text: snippet(sourceFile, node),
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  const suppressions = text.match(suppressionRe);
  fileCounts.tsSuppressions = suppressions ? suppressions.length : 0;

  for (const key of Object.keys(fileCounts)) {
    totals[key] += fileCounts[key];
    byPackage[packageRoot][key] += fileCounts[key];
    if (isProduction) {
      productionTotals[key] += fileCounts[key];
    }
  }

  if (sumCounts(fileCounts) > 0) {
    fileRows.push({
      file: relPath,
      production: isProduction,
      counts: fileCounts,
      countedTotal: sumCounts(fileCounts),
      nonNullSamples,
    });
  }
}

const files = [];
for (const sourceRoot of roots) {
  walk(path.join(root, sourceRoot), files);
}

const totals = createEmptyCounts();
const productionTotals = createEmptyCounts();
const byPackage = Object.fromEntries(roots.map((sourceRoot) => [sourceRoot, createEmptyCounts()]));
const fileRows = [];

for (const filePath of files) {
  countFile(filePath, totals, productionTotals, byPackage, fileRows);
}

function formatPackageBreakdown(counts) {
  return {
    any: counts.any,
    type_assertions: counts.typeAssertions,
    non_null_assertions: counts.nonNullAssertions,
    ts_suppressions: counts.tsSuppressions,
    counted_total: sumCounts(counts),
  };
}

const packageBreakdown = Object.fromEntries(
  roots.map((sourceRoot) => [sourceRoot, formatPackageBreakdown(byPackage[sourceRoot])])
);

const topNonNullFiles = fileRows
  .filter(row => row.counts.nonNullAssertions > 0)
  .sort((a, b) => b.counts.nonNullAssertions - a.counts.nonNullAssertions)
  .slice(0, 25)
  .map(row => ({
    file: row.file,
    production: row.production,
    nonNullAssertions: row.counts.nonNullAssertions,
    samples: row.nonNullSamples.slice(0, 5),
  }));

const output = {
  generatedAt: new Date().toISOString(),
  gitSha: getGitSha(),
  roots,
  productionExcludes: [
    'e2e/**',
    '**/__tests__/**',
    '**/{test,tests,fixtures,mocks,mock}/**',
    '**/*.{test,spec}.ts',
    '**/*.{test,spec}.tsx',
  ],
  scannedFileCount: files.length,
  auditScope: {
    ...totals,
    countedTotal: sumCounts(totals),
  },
  productionOnly: {
    ...productionTotals,
    countedTotal: sumCounts(productionTotals),
  },
  packageBreakdown,
  topNonNullFiles,
};

console.log(JSON.stringify(output, null, 2));
