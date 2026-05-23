#!/usr/bin/env node
/**
 * Canonical type-safety measurement recipe.
 *
 * Usage:
 *   pnpm type-safety:report          # full JSON report
 *   pnpm type-safety:report --brief  # human-readable summary
 *
 * Three complementary metrics (do not compare them 1:1):
 *   1. AST syntax counts     — official audit denominator (`type-safety:counts`)
 *   2. tsc implicit-any      — compiler gate for classic implicit any
 *   3. ESLint rule warnings  — worklist for fixes (especially no-unsafe-*)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const brief = process.argv.includes('--brief');
const testPathRe = /(^|\/)(__tests__|test|tests|fixtures|mocks|mock|e2e)(\/|$)|\.(test|spec)\.tsx?$/;

function runJson(command, args) {
  const output = execFileSync(command, args, { cwd: root, encoding: 'utf8' });
  return JSON.parse(output);
}

function implicitAnyDiagnostics(tsconfigRel) {
  const configPath = path.resolve(tsconfigRel);
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const diags = [];

  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    if (!/implicitly has an 'any' type|implicitly has an any type/.test(message) || !diagnostic.file) {
      continue;
    }
    const rel = path.relative(root, diagnostic.file.fileName);
    diags.push({
      file: rel,
      line: diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1,
      message,
      production: !testPathRe.test(rel),
    });
  }

  return {
    tsconfig: tsconfigRel,
    noImplicitAny: parsed.options.noImplicitAny ?? parsed.options.strict ?? false,
    total: diags.length,
    production: diags.filter((item) => item.production).length,
    samples: diags.slice(0, 10),
  };
}

function paramAnyCounts(tsconfigRel) {
  const configPath = path.resolve(tsconfigRel);
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const checker = program.getTypeChecker();
  let total = 0;
  let production = 0;
  const byFile = new Map();

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || sourceFile.fileName.includes('node_modules')) continue;
    const rel = path.relative(root, sourceFile.fileName);
    const isProduction = !testPathRe.test(rel);

    function visit(node) {
      if (ts.isParameter(node) && !node.type) {
        const type = checker.getTypeAtLocation(node);
        if (type.flags & ts.TypeFlags.Any) {
          total += 1;
          if (isProduction) production += 1;
          const items = byFile.get(rel) ?? [];
          items.push({
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            name: node.name.getText(sourceFile).slice(0, 40),
          });
          byFile.set(rel, items);
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  const topFiles = [...byFile.entries()]
    .map(([file, items]) => ({ file, count: items.length, samples: items.slice(0, 3) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return { tsconfig: tsconfigRel, total, production, topFiles };
}

function eslintRuleCounts() {
  const tmpFile = path.join(root, '.tmp-eslint-report.json');
  const result = spawnSync('pnpm', ['exec', 'eslint', '.', '--format', 'json', '--output-file', tmpFile], {
    cwd: root,
    encoding: 'utf8',
  });

  if (!fs.existsSync(tmpFile)) {
    return { error: result.stderr?.trim() || 'eslint produced no output file' };
  }

  const output = fs.readFileSync(tmpFile, 'utf8').trim();
  fs.unlinkSync(tmpFile);

  if (!output) {
    return { error: 'eslint output file was empty' };
  }

  const files = JSON.parse(output);
  const trackedRules = [
    '@typescript-eslint/no-explicit-any',
    '@typescript-eslint/no-non-null-assertion',
    '@typescript-eslint/no-unsafe-assignment',
    '@typescript-eslint/no-unsafe-member-access',
    '@typescript-eslint/no-unsafe-argument',
    '@typescript-eslint/no-unsafe-return',
    '@typescript-eslint/no-unsafe-call',
    '@typescript-eslint/no-unnecessary-condition',
    '@typescript-eslint/explicit-module-boundary-types',
    '@typescript-eslint/switch-exhaustiveness-check',
    '@typescript-eslint/no-floating-promises',
  ];
  const counts = Object.fromEntries(trackedRules.map((rule) => [rule, { total: 0, production: 0 }]));

  for (const file of files) {
    const rel = file.filePath.replace(`${root}/`, '');
    const isProduction = !testPathRe.test(rel);
    for (const message of file.messages) {
      if (!counts[message.ruleId]) continue;
      counts[message.ruleId].total += 1;
      if (isProduction) counts[message.ruleId].production += 1;
    }
  }

  return counts;
}

const astCounts = runJson('node', ['./scripts/type-safety-counts.mjs']);
const implicitAny = [
  implicitAnyDiagnostics('api/tsconfig.json'),
  implicitAnyDiagnostics('web/tsconfig.json'),
  implicitAnyDiagnostics('shared/tsconfig.json'),
  implicitAnyDiagnostics('e2e/tsconfig.json'),
];
const paramAny = [
  paramAnyCounts('api/tsconfig.json'),
  paramAnyCounts('web/tsconfig.json'),
  paramAnyCounts('shared/tsconfig.json'),
];
const eslintCounts = eslintRuleCounts();

const report = {
  generatedAt: new Date().toISOString(),
  recipe: {
    explicitSyntax: 'pnpm type-safety:counts',
    implicitAnyGate: 'pnpm type-check',
    eslintWorklist: 'pnpm lint',
    fullReport: 'pnpm type-safety:report',
    productionFilter:
      'Exclude e2e/**, **/__tests__/**, **/{test,tests,fixtures,mocks,mock}/**, **/*.{test,spec}.{ts,tsx}',
    notes: [
      'Use AST counts for official explicit any / as / non-null syntax baselines.',
      'Use tsc implicit-any diagnostics for classic unannotated parameters/bindings.',
      'Use paramAny for unannotated callback params that infer to any from an any-typed parent.',
      'ESLint no-unsafe-* counts downstream usage; one any site can produce many warnings.',
    ],
  },
  astCounts: {
    auditScope: astCounts.auditScope,
    productionOnly: astCounts.productionOnly,
  },
  implicitAny,
  paramAny,
  eslintCounts,
  additionalRulesNotEnabled: [
    '@typescript-eslint/typedef (deprecated in typescript-eslint 8.33; use tsc noImplicitAny + explicit-module-boundary-types)',
    '@typescript-eslint/strict-boolean-expressions (intentionally off; very noisy)',
    '@typescript-eslint/prefer-nullish-coalescing (stylistic; not type-safety critical)',
    '@typescript-eslint/prefer-optional-chain (stylistic)',
    '@typescript-eslint/no-invalid-void-type',
    '@typescript-eslint/no-meaningless-void-operator',
    '@typescript-eslint/require-array-sort-compare',
    '@typescript-eslint/explicit-function-return-type (narrower alternative to deprecated typedef)',
    '@typescript-eslint/use-unknown-in-catch-variables (not available in typescript-eslint 8.59 plugin surface)',
  ],
};

if (brief) {
  const implicitTotal = implicitAny.reduce((sum, item) => sum + item.total, 0);
  const implicitProd = implicitAny.reduce((sum, item) => sum + item.production, 0);
  const paramAnyProd = paramAny.reduce((sum, item) => sum + item.production, 0);

  console.log('Type-safety report (brief)');
  console.log('==========================');
  console.log(`AST explicit any:           ${astCounts.auditScope.any} total / ${astCounts.productionOnly.any} prod`);
  console.log(`AST non-null assertions:    ${astCounts.auditScope.nonNullAssertions} total / ${astCounts.productionOnly.nonNullAssertions} prod`);
  console.log(`tsc implicit-any errors:    ${implicitTotal} total / ${implicitProd} prod`);
  console.log(`Unannotated params as any:  ${paramAnyProd} prod (api+web)`);
  console.log(`ESLint no-explicit-any:     ${eslintCounts['@typescript-eslint/no-explicit-any']?.total ?? 'n/a'} total / ${eslintCounts['@typescript-eslint/no-explicit-any']?.production ?? 'n/a'} prod`);
  console.log(`ESLint no-unsafe-member-access: ${eslintCounts['@typescript-eslint/no-unsafe-member-access']?.total ?? 'n/a'} total / ${eslintCounts['@typescript-eslint/no-unsafe-member-access']?.production ?? 'n/a'} prod`);
  console.log('');
  console.log('Canonical commands:');
  for (const [label, command] of Object.entries(report.recipe).filter(([key]) => !['productionFilter', 'notes'].includes(key))) {
    console.log(`  ${label}: ${command}`);
  }
} else {
  console.log(JSON.stringify(report, null, 2));
}
