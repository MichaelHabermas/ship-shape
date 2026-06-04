#!/usr/bin/env node
// Integration boundary verifier keeps reference integrations on the public SDK contract.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const integrationsDir = path.join(rootDir, 'integrations');
const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const ignoredDirs = new Set(['node_modules', 'dist', 'build', 'coverage']);
const shipPackagesAllowedInIntegrations = new Set(['@ship/sdk']);
const problems = [];

if (!fs.existsSync(integrationsDir)) {
  console.log('Integration boundary OK: no integrations directory');
  process.exit(0);
}

for (const filePath of walk(integrationsDir)) {
  if (path.basename(filePath) === 'package.json') {
    checkPackageJson(filePath);
    continue;
  }
  if (!sourceExtensions.has(path.extname(filePath))) continue;
  checkSourceFile(filePath);
}

if (problems.length > 0) {
  console.error('Integration boundary failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('Integration boundary OK: integrations import Ship only through @ship/sdk');

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(entryPath);
    } else if (entry.isFile()) {
      yield entryPath;
    }
  }
}

function checkPackageJson(filePath) {
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const dependencyBlocks = [
    ['dependencies', json.dependencies],
    ['devDependencies', json.devDependencies],
    ['peerDependencies', json.peerDependencies],
    ['optionalDependencies', json.optionalDependencies],
  ];
  for (const [blockName, dependencies] of dependencyBlocks) {
    if (!dependencies || typeof dependencies !== 'object') continue;
    for (const dependency of Object.keys(dependencies)) {
      if (dependency.startsWith('@ship/') && !shipPackagesAllowedInIntegrations.has(dependency)) {
        problems.push(`${relative(filePath)} ${blockName} uses ${dependency}; integrations may depend on @ship/sdk only`);
      }
    }
  }
}

function checkSourceFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const specifiers = [
    ...extractSpecifiers(source, /\bimport\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g),
    ...extractSpecifiers(source, /\bexport\s+[^'"]*\s+from\s+['"]([^'"]+)['"]/g),
    ...extractSpecifiers(source, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...extractSpecifiers(source, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ];

  for (const specifier of specifiers) {
    const reason = bannedSpecifierReason(filePath, specifier);
    if (reason) problems.push(`${relative(filePath)} imports ${specifier}: ${reason}`);
  }
}

function extractSpecifiers(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]).filter(Boolean);
}

function bannedSpecifierReason(filePath, specifier) {
  if (specifier.startsWith('@ship/') && !shipPackagesAllowedInIntegrations.has(specifier)) {
    return 'Ship package access is limited to @ship/sdk';
  }
  if (specifier.startsWith('@/')) {
    return 'application aliases are not part of the public integration boundary';
  }
  if (/(^|\/)(api\/src|web\/src|shared)(\/|$)/.test(specifier)) {
    return 'application internals are not part of the public integration boundary';
  }
  if (!specifier.startsWith('.')) return null;

  const resolved = path.resolve(path.dirname(filePath), specifier);
  const blockedRoots = [
    path.join(rootDir, 'api', 'src'),
    path.join(rootDir, 'web', 'src'),
    path.join(rootDir, 'shared'),
  ];
  const blockedRoot = blockedRoots.find((candidate) => isInside(resolved, candidate));
  return blockedRoot
    ? `relative import resolves into ${relative(blockedRoot)}`
    : null;
}

function isInside(candidate, parent) {
  const relativePath = path.relative(parent, candidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function relative(filePath) {
  return path.relative(rootDir, filePath);
}
