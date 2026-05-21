#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const appPath = join(root, 'api/src/app.ts');
const routesDir = join(root, 'api/src/routes');
const openApiPath = join(root, 'api/openapi.json');
const strict = process.argv.includes('--strict');

const methods = ['get', 'post', 'put', 'patch', 'delete'];
const ignoredRuntimeRoutes = new Set([
  'GET /api/docs',
  'GET /api/openapi.json',
  'GET /api/openapi.yaml',
  'GET /health',
]);

function normalizeOpenApiPath(path) {
  return path.replace(/\{([^}]+)\}/g, ':param');
}

function normalizeRuntimePath(path) {
  return path.replace(/\/+/g, '/').replace(/\/$/, '').replace(/:[^/]+/g, ':param') || '/';
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function extractMounts(appSource) {
  const mounts = new Map();
  const mountRegex = /app\.use\(\s*['"`](\/api\/[^'"`]+)['"`]\s*,(?:\s*conditionalCsrf\s*,)?\s*([A-Za-z0-9_]+Routes|[A-Za-z0-9_]+Router|[A-Za-z0-9_]+)\s*\)/g;
  for (const match of appSource.matchAll(mountRegex)) {
    const [, mountPath, routerName] = match;
    const paths = mounts.get(routerName) ?? [];
    paths.push(mountPath);
    mounts.set(routerName, paths);
  }
  return mounts;
}

function extractRouteImports(appSource) {
  const imports = new Map();
  const importRegex = /import\s+([A-Za-z0-9_]+)(?:\s*,\s*\{[^}]+\})?\s+from\s+['"`]\.\/routes\/([^'"`]+)\.js['"`]/g;
  for (const match of appSource.matchAll(importRegex)) {
    imports.set(match[2], match[1]);
  }
  return imports;
}

function exportNamesForRouteFile(source, fileBase) {
  const names = new Set();
  const defaultRegex = /export\s+default\s+([A-Za-z0-9_]+)/;
  const defaultMatch = source.match(defaultRegex);
  if (defaultMatch) names.add(defaultMatch[1]);

  for (const match of source.matchAll(/export\s+const\s+([A-Za-z0-9_]+)(?:\s*:[^=]+)?\s*=/g)) {
    names.add(match[1]);
  }

  names.add(`${fileBase}Routes`);
  names.add(`${fileBase}Router`);
  names.add(fileBase);
  return names;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractRouteMethods(source, routerName, mountPath) {
  const routes = [];
  for (const method of methods) {
    const routeRegex = new RegExp(`${escapeRegex(routerName)}\\.${method}\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
    for (const match of source.matchAll(routeRegex)) {
      const childPath = match[1] === '/' ? '' : match[1];
      routes.push(`${method.toUpperCase()} ${normalizeRuntimePath(`${mountPath}/${childPath}`)}`);
    }
  }
  return routes;
}

function runtimeRoutes() {
  const appSource = read(appPath);
  const mounts = extractMounts(appSource);
  const importedRouteNames = extractRouteImports(appSource);
  const routes = new Set();

  for (const method of methods) {
    const appRouteRegex = new RegExp(`app\\.${method}\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
    for (const match of appSource.matchAll(appRouteRegex)) {
      routes.add(`${method.toUpperCase()} ${normalizeRuntimePath(match[1])}`);
    }
  }

  for (const file of readdirSync(routesDir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
    const routePath = join(routesDir, file);
    const source = read(routePath);
    const fileBase = basename(file, '.ts');
    const routerNames = exportNamesForRouteFile(source, fileBase);
    const importedDefaultName = importedRouteNames.get(fileBase);
    if (importedDefaultName) routerNames.add(importedDefaultName);

    for (const routerName of routerNames) {
      const mountPaths = mounts.get(routerName);
      if (!mountPaths) continue;
      const sourceRouterName = importedDefaultName === routerName ? 'router' : routerName;
      for (const mountPath of mountPaths) {
        for (const route of extractRouteMethods(source, sourceRouterName, mountPath)) {
          routes.add(route);
        }
      }
    }
  }

  for (const route of ignoredRuntimeRoutes) routes.delete(route);
  return routes;
}

function openApiRoutes() {
  const spec = JSON.parse(read(openApiPath));
  const routes = new Set();
  const paths = Object.keys(spec.paths ?? {});
  const prefixed = paths.filter((path) => path.startsWith('/api/'));

  if (prefixed.length > 0) {
    console.error('OpenAPI paths must omit /api because servers[0].url is /api:');
    for (const path of prefixed) console.error(`  ${path}`);
    process.exitCode = 1;
  }

  for (const [path, operations] of Object.entries(spec.paths ?? {})) {
    for (const method of methods) {
      if (operations?.[method]) {
        routes.add(`${method.toUpperCase()} /api${normalizeOpenApiPath(path)}`);
      }
    }
  }
  return routes;
}

const runtime = runtimeRoutes();
const openapi = openApiRoutes();

const missing = [...runtime].filter((route) => !openapi.has(route)).sort();
const stale = [...openapi].filter((route) => !runtime.has(route)).sort();

console.log(`Runtime routes: ${runtime.size}`);
console.log(`OpenAPI routes: ${openapi.size}`);
console.log(`Missing from OpenAPI: ${missing.length}`);
for (const route of missing) console.log(`  - ${route}`);
console.log(`Stale in OpenAPI: ${stale.length}`);
for (const route of stale) console.log(`  - ${route}`);
if ((missing.length > 0 || stale.length > 0) && !strict) {
  console.log('OpenAPI route coverage check is report-only. Pass --strict to fail on missing or stale routes.');
}

if (strict && (missing.length > 0 || stale.length > 0)) {
  process.exitCode = 1;
}

if (process.exitCode) process.exit(process.exitCode);
