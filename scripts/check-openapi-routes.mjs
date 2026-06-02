#!/usr/bin/env node
// Checks runtime Express routes against the generated public OpenAPI route contract.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const appPath = join(root, 'api/src/app.ts');
const routesDir = join(root, 'api/src/routes');
const platformDir = join(root, 'api/src/platform');
const openApiPath = join(root, 'api/openapi.json');
const strict = process.argv.includes('--strict');

const methods = ['get', 'post', 'put', 'patch', 'delete'];
const ignoredRuntimeRoutes = new Set([
  'GET /api/docs',
  'GET /api/openapi.json',
  'GET /api/openapi.yaml',
  'POST /api/fleetgraph/test/worker-tick',
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

function extractRouteBindings(appSource) {
  const bindings = [];
  const seen = new Set();

  function add(routerName, importRoot, importPath) {
    const key = `${routerName}\0${importRoot}\0${importPath}`;
    if (seen.has(key)) return;
    seen.add(key);
    bindings.push({ routerName, importRoot, importPath });
  }

  for (const importRoot of ['routes', 'platform']) {
    const mixedRegex = new RegExp(
      `import\\s+([A-Za-z0-9_]+)(?:\\s*,\\s*\\{([^}]+)\\})?\\s+from\\s+['"\`]\\.\\/${importRoot}\\/([^'"\`]+)\\.js['"\`]`,
      'g'
    );
    for (const [, defaultImport, namedImports, importPath] of appSource.matchAll(mixedRegex)) {
      add(defaultImport, importRoot, importPath);
      if (namedImports) {
        for (const part of namedImports.split(',')) {
          add(importName(part), importRoot, importPath);
        }
      }
    }

    const namedOnlyRegex = new RegExp(
      `import\\s+\\{([^}]+)\\}\\s+from\\s+['"\`]\\.\\/${importRoot}\\/([^'"\`]+)\\.js['"\`]`,
      'g'
    );
    for (const [, namedImports, importPath] of appSource.matchAll(namedOnlyRegex)) {
      for (const part of namedImports.split(',')) {
        add(importName(part), importRoot, importPath);
      }
    }
  }

  return bindings;
}

function importName(part) {
  return part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim();
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

function localImports(source, sourceFile) {
  const imports = new Map();
  const importRegex = /import\s+(?:([A-Za-z0-9_]+)(?:\s*,\s*)?)?(?:\{([^}]+)\})?\s+from\s+['"`](\.{1,2}\/[^'"`]+)\.js['"`]/g;
  for (const [, defaultImport, namedImports, importPath] of source.matchAll(importRegex)) {
    const target = resolve(dirname(sourceFile), `${importPath}.ts`);
    if (defaultImport) imports.set(defaultImport, target);
    if (namedImports) {
      for (const part of namedImports.split(',')) {
        imports.set(importName(part), target);
      }
    }
  }
  return imports;
}

function extractRouterUses(source, routerName) {
  const uses = [];
  const useRegex = new RegExp(
    `${escapeRegex(routerName)}\\.use\\(\\s*(?:['"\`]([^'"\`]*)['"\`]\\s*,\\s*)?([A-Za-z0-9_]+)\\s*\\)`,
    'g'
  );
  for (const [, childPath = '', childRouterName] of source.matchAll(useRegex)) {
    uses.push({ childPath, childRouterName });
  }
  return uses;
}

function listRouteModuleFiles(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.endsWith('.test.ts') || entry.name === 'types.ts') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRouteModuleFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith('.ts')) files.push(fullPath);
  }
  return files;
}

function runtimeRoutes() {
  const appSource = read(appPath);
  const mounts = extractMounts(appSource);
  const routeBindings = extractRouteBindings(appSource);
  const routes = new Set();

  for (const method of methods) {
    const appRouteRegex = new RegExp(`app\\.${method}\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
    for (const match of appSource.matchAll(appRouteRegex)) {
      routes.add(`${method.toUpperCase()} ${normalizeRuntimePath(match[1])}`);
    }
  }

  const visitedRouters = new Set();

  function collectRoutesFromSource(source, sourceFile, fileBase, importedDefaultName) {
    const routerNames = exportNamesForRouteFile(source, fileBase);
    if (importedDefaultName) routerNames.add(importedDefaultName);

    for (const routerName of routerNames) {
      const mountPaths = mounts.get(routerName);
      if (!mountPaths) continue;
      const sourceRouterNames = new Set([routerName]);
      if (importedDefaultName === routerName) sourceRouterNames.add('router');
      for (const sourceRouterName of sourceRouterNames) {
        for (const mountPath of mountPaths) {
          collectRoutesForRouter(source, sourceFile, sourceRouterName, mountPath);
        }
      }
    }
  }

  function collectRoutesForRouter(source, sourceFile, routerName, mountPath) {
    const visitKey = `${sourceFile}\0${routerName}\0${mountPath}`;
    if (visitedRouters.has(visitKey)) return;
    visitedRouters.add(visitKey);

    for (const route of extractRouteMethods(source, routerName, mountPath)) {
      routes.add(route);
    }

    const imports = localImports(source, sourceFile);
    for (const { childPath, childRouterName } of extractRouterUses(source, routerName)) {
      const childFile = imports.get(childRouterName);
      if (!childFile || !existsSync(childFile)) continue;
      const childMountPath = normalizeRuntimePath(`${mountPath}/${childPath}`);
      collectRoutesForRouter(read(childFile), childFile, childRouterName, childMountPath);
    }
  }

  const scannedFiles = new Set();

  for (const { routerName, importRoot, importPath } of routeBindings) {
    const sourceDir = importRoot === 'platform' ? platformDir : routesDir;
    const fileBase = importPath.split('/')[0];
    let filesToScan = [];

    if (importPath.endsWith('/index')) {
      filesToScan = listRouteModuleFiles(join(sourceDir, importPath.replace(/\/index$/, '')));
    } else if (importPath.includes('/')) {
      const nestedFile = join(sourceDir, `${importPath}.ts`);
      filesToScan = existsSync(nestedFile)
        ? [nestedFile]
        : listRouteModuleFiles(join(sourceDir, importPath));
    } else {
      filesToScan = [join(sourceDir, `${importPath}.ts`)];
    }

    for (const routePath of filesToScan) {
      if (!existsSync(routePath) || scannedFiles.has(routePath)) continue;
      scannedFiles.add(routePath);
      collectRoutesFromSource(read(routePath), routePath, fileBase, routerName);
    }
  }

  // Legacy flat barrels that re-export folder routers (if any remain).
  for (const file of readdirSync(routesDir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
    const routePath = join(routesDir, file);
    if (scannedFiles.has(routePath)) continue;
    const source = read(routePath);
    const fileBase = basename(file, '.ts');

    const reexportMatch = source.match(/export\s+\{\s*default\s*\}\s+from\s+['"`]\.\/([^'"`]+)\/index\.js['"`]/);
    if (reexportMatch) {
      const subDir = join(routesDir, reexportMatch[1]);
      for (const subFile of listRouteModuleFiles(subDir)) {
        if (scannedFiles.has(subFile)) continue;
        scannedFiles.add(subFile);
        const binding = routeBindings.find((entry) => entry.importPath === fileBase || entry.importPath === `${fileBase}/index`);
        collectRoutesFromSource(read(subFile), subFile, fileBase, binding?.routerName);
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
