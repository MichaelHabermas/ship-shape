#!/usr/bin/env node
import { resolve } from 'node:path';
import { readJson, readLedger, repoPathExists, repoRoot, schemaPath } from './ledger-utils.mjs';

const allowedStatuses = new Set(['proven', 'partial', 'open', 'needs_fill_in', 'not_measured']);
const allowedEvidenceTypes = new Set([
  'source_doc',
  'methodology',
  'command',
  'artifact',
  'screenshot',
  'test_run',
  'manual_observation',
]);
const allowedOrigins = new Set(['manual_entry', 'report_extracted', 'artifact_parsed', 'computed']);
const allowedConfidence = new Set(['artifact_backed', 'report_backed', 'manual', 'inferred']);
const allowedAcceptanceResults = new Set(['pass', 'fail', 'warn', 'not_applicable']);
const canonicalCategoryNumbers = [1, 2, 3, 4, 5, 6, 7, 8];
const canonicalCategories = new Map([
  [1, { id: 'cat-1-type-safety', title: 'Type Safety' }],
  [2, { id: 'cat-2-bundle-size', title: 'Bundle Size' }],
  [3, { id: 'cat-3-api-response-time', title: 'API Response Time' }],
  [4, { id: 'cat-4-database-query-efficiency', title: 'Database Query Efficiency' }],
  [5, { id: 'cat-5-test-coverage-quality', title: 'Test Coverage and Quality' }],
  [6, { id: 'cat-6-runtime-error-handling', title: 'Runtime Error and Edge Case Handling' }],
  [7, { id: 'cat-7-accessibility', title: 'Accessibility Compliance' }],
  [8, { id: 'cat-8-security-audit', title: 'Security Audit' }],
]);
const pathBackedEvidenceTypes = new Set(['artifact', 'screenshot', 'source_doc', 'methodology']);
const executableEvidenceTypes = new Set(['command', 'test_run']);

function fail(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requirePlainObjectValue(errors, value, path) {
  if (!isPlainObject(value)) {
    fail(errors, path, 'must be an object');
    return false;
  }
  return true;
}

function requireArray(errors, object, key, path, { min = 0 } = {}) {
  if (!isPlainObject(object)) {
    fail(errors, path, 'must be an object');
    return [];
  }
  if (!Array.isArray(object[key])) {
    fail(errors, `${path}.${key}`, 'must be an array');
    return [];
  }
  if (object[key].length < min) {
    fail(errors, `${path}.${key}`, `must contain at least ${min} item(s)`);
  }
  return object[key];
}

function requireObject(errors, object, key, path) {
  if (!isPlainObject(object)) {
    fail(errors, path, 'must be an object');
    return {};
  }
  if (!isPlainObject(object[key])) {
    fail(errors, `${path}.${key}`, 'must be an object');
    return {};
  }
  return object[key];
}

function requireString(errors, object, key, path) {
  if (!isPlainObject(object)) {
    fail(errors, path, 'must be an object');
    return '';
  }
  if (typeof object[key] !== 'string' || object[key].trim() === '') {
    fail(errors, `${path}.${key}`, 'must be a non-empty string');
    return '';
  }
  return object[key];
}

function validateEnumArray(errors, object, key, path, allowedValues) {
  for (const value of requireArray(errors, object, key, path, { min: 1 })) {
    if (!allowedValues.has(value)) fail(errors, `${path}.${key}`, `unknown value ${value}`);
  }
}

function validateTargetResult(errors, target, targetPath) {
  if (target.result === 'not_applicable' || target.operator === 'manual_gate') return;

  if (target.operator === 'percent_decrease_at_least' || target.operator === 'count_at_least') {
    if (typeof target.threshold !== 'number') fail(errors, `${targetPath}.threshold`, 'must be numeric for this operator');
    if (typeof target.actual !== 'number') fail(errors, `${targetPath}.actual`, 'must be numeric for this operator');
    if (typeof target.threshold !== 'number' || typeof target.actual !== 'number') return;
    const computedResult = target.actual >= target.threshold ? 'pass' : 'fail';
    if (target.result !== computedResult && target.result !== 'warn') {
      fail(errors, `${targetPath}.result`, `must be ${computedResult} for actual ${target.actual} and threshold ${target.threshold}`);
    }
    return;
  }

  if (target.operator === 'boolean_true') {
    if (typeof target.actual !== 'boolean') fail(errors, `${targetPath}.actual`, 'must be boolean for boolean_true');
    if (target.threshold !== true) fail(errors, `${targetPath}.threshold`, 'must be true for boolean_true');
    if (typeof target.actual !== 'boolean' || target.threshold !== true) return;
    const computedResult = target.actual ? 'pass' : 'fail';
    if (target.result !== computedResult && target.result !== 'warn') {
      fail(errors, `${targetPath}.result`, `must be ${computedResult} for actual ${target.actual}`);
    }
  }
}

function validateReferenceIds(errors, item, key, path, knownIds) {
  if (!(key in item)) return;
  if (!Array.isArray(item[key])) {
    fail(errors, `${path}.${key}`, 'must be an array when present');
    return;
  }
  for (const referenceId of item[key]) {
    if (!knownIds.has(referenceId)) fail(errors, `${path}.${key}`, `unknown reference id ${referenceId}`);
  }
}

function validateLedgerShape(ledger) {
  const errors = [];
  if (ledger.schema_version !== 2) {
    fail(errors, 'schema_version', 'must be 2');
  }
  requireString(errors, ledger, 'purpose', '$');
  validateEnumArray(errors, ledger, 'status_values', '$', allowedStatuses);
  validateEnumArray(errors, ledger, 'evidence_types', '$', allowedEvidenceTypes);
  validateEnumArray(errors, ledger, 'measurement_origins', '$', allowedOrigins);
  validateEnumArray(errors, ledger, 'confidence_values', '$', allowedConfidence);

  const seenCategoryIds = new Set();
  const seenCategoryNumbers = new Set();
  const categories = requireArray(errors, ledger, 'categories', '$', { min: canonicalCategoryNumbers.length });
  for (const number of canonicalCategoryNumbers) {
    if (!categories.some((category) => category?.number === number)) {
      fail(errors, '$.categories', `must include Category ${number}`);
    }
  }
  for (const category of categories) {
    if (!canonicalCategoryNumbers.includes(category?.number)) {
      fail(errors, '$.categories', `unexpected category number ${category?.number}`);
    }
  }

  for (const [index, category] of categories.entries()) {
    const path = `categories[${index}]`;
    if (!requirePlainObjectValue(errors, category, path)) continue;
    const id = requireString(errors, category, 'id', path);
    if (seenCategoryIds.has(id)) fail(errors, `${path}.id`, `duplicate category id ${id}`);
    seenCategoryIds.add(id);
    if (!Number.isInteger(category.number)) fail(errors, `${path}.number`, 'must be an integer');
    if (seenCategoryNumbers.has(category.number)) fail(errors, `${path}.number`, `duplicate category number ${category.number}`);
    seenCategoryNumbers.add(category.number);
    const title = requireString(errors, category, 'title', path);
    const canonicalCategory = canonicalCategories.get(category.number);
    if (canonicalCategory) {
      if (id !== canonicalCategory.id) fail(errors, `${path}.id`, `must be canonical id ${canonicalCategory.id} for Category ${category.number}`);
      if (title !== canonicalCategory.title) fail(errors, `${path}.title`, `must be canonical title ${canonicalCategory.title} for Category ${category.number}`);
    }
    if (!allowedStatuses.has(category.status)) fail(errors, `${path}.status`, `unknown status ${category.status}`);

    const sourceRequirement = requireObject(errors, category, 'source_requirement', path);
    requireString(errors, sourceRequirement, 'statement', `${path}.source_requirement`);
    requireString(errors, sourceRequirement, 'source', `${path}.source_requirement`);
    requireObject(errors, category, 'audit_deliverable', path);

    const collectionNames = [
      'rubric_items',
      'measurements',
      'derived_metrics',
      'targets',
      'acceptance_tests',
      'claims',
      'evidence',
      'comparability',
      'summary_cards',
    ];
    const knownIds = new Set();
    const knownItems = new Map();
    for (const collectionName of collectionNames) {
      const collection = Array.isArray(category[collectionName]) ? category[collectionName] : [];
      for (const [itemIndex, item] of collection.entries()) {
        if (!requirePlainObjectValue(errors, item, `${path}.${collectionName}[${itemIndex}]`)) continue;
        if (!item?.id) continue;
        if (knownIds.has(item.id)) fail(errors, `${path}.${collectionName}`, `duplicate category-local id ${item.id}`);
        knownIds.add(item.id);
        knownItems.set(item.id, item);
      }
    }

    const rubricItems = requireArray(errors, category, 'rubric_items', path, { min: 1 });
    for (const [itemIndex, item] of rubricItems.entries()) {
      const itemPath = `${path}.rubric_items[${itemIndex}]`;
      if (!requirePlainObjectValue(errors, item, itemPath)) continue;
      requireString(errors, item, 'id', itemPath);
      if (!['audit', 'improvement'].includes(item.phase)) fail(errors, `${itemPath}.phase`, 'must be audit or improvement');
      if (typeof item.required !== 'boolean') fail(errors, `${itemPath}.required`, 'must be boolean');
      if (!['present', 'partial', 'missing', 'not_applicable'].includes(item.status)) {
        fail(errors, `${itemPath}.status`, `unknown rubric status ${item.status}`);
      }
      requireString(errors, item, 'location', itemPath);
      validateReferenceIds(errors, item, 'references', itemPath, knownIds);
    }

    for (const [measurementIndex, measurement] of requireArray(errors, category, 'measurements', path, { min: 1 }).entries()) {
      const measurementPath = `${path}.measurements[${measurementIndex}]`;
      if (!requirePlainObjectValue(errors, measurement, measurementPath)) continue;
      requireString(errors, measurement, 'id', measurementPath);
      requireString(errors, measurement, 'kind', measurementPath);
      requireString(errors, measurement, 'label', measurementPath);
      requireString(errors, measurement, 'recorded_at', measurementPath);
      const hasValues = Object.hasOwn(measurement, 'values');
      const hasEndpoints = Object.hasOwn(measurement, 'endpoints');
      if (!hasValues && !hasEndpoints) {
        fail(errors, measurementPath, 'must include values or endpoints');
      }
      if (hasValues) {
        if (!isPlainObject(measurement.values)) {
          fail(errors, `${measurementPath}.values`, 'must be an object when present');
        } else if (Object.keys(measurement.values).length === 0) {
          fail(errors, `${measurementPath}.values`, 'must not be empty');
        }
      }
      if (hasEndpoints) {
        if (!Array.isArray(measurement.endpoints)) {
          fail(errors, `${measurementPath}.endpoints`, 'must be an array when present');
        } else if (measurement.endpoints.length === 0) {
          fail(errors, `${measurementPath}.endpoints`, 'must not be empty');
        }
      }
      if (measurement.artifact && !repoPathExists(measurement.artifact)) {
        fail(errors, `${measurementPath}.artifact`, `path does not exist: ${measurement.artifact}`);
      }
      if (!allowedOrigins.has(measurement.origin)) fail(errors, `${measurementPath}.origin`, `unknown origin ${measurement.origin}`);
      if (!allowedConfidence.has(measurement.confidence)) fail(errors, `${measurementPath}.confidence`, `unknown confidence ${measurement.confidence}`);
      requireString(errors, measurement, 'source', measurementPath);
      validateReferenceIds(errors, measurement, 'references', measurementPath, knownIds);
    }

    for (const [metricIndex, metric] of requireArray(errors, category, 'derived_metrics', path).entries()) {
      const metricPath = `${path}.derived_metrics[${metricIndex}]`;
      if (!requirePlainObjectValue(errors, metric, metricPath)) continue;
      requireString(errors, metric, 'id', metricPath);
      requireString(errors, metric, 'kind', metricPath);
      if (!allowedOrigins.has(metric.origin)) fail(errors, `${metricPath}.origin`, `unknown origin ${metric.origin}`);
      if (!allowedConfidence.has(metric.confidence)) fail(errors, `${metricPath}.confidence`, `unknown confidence ${metric.confidence}`);
      validateReferenceIds(errors, metric, 'references', metricPath, knownIds);
    }

    for (const [targetIndex, target] of requireArray(errors, category, 'targets', path).entries()) {
      const targetPath = `${path}.targets[${targetIndex}]`;
      if (!requirePlainObjectValue(errors, target, targetPath)) continue;
      requireString(errors, target, 'id', targetPath);
      requireString(errors, target, 'description', targetPath);
      requireString(errors, target, 'operator', targetPath);
      if (!allowedAcceptanceResults.has(target.result)) fail(errors, `${targetPath}.result`, `unknown result ${target.result}`);
      if (target.metric_id && !knownIds.has(target.metric_id)) fail(errors, `${targetPath}.metric_id`, `unknown metric id ${target.metric_id}`);
      if (target.operator === 'manual_gate') {
        requireString(errors, target, 'reason', targetPath);
        if (!Array.isArray(target.references) || target.references.length === 0) {
          fail(errors, `${targetPath}.references`, 'manual_gate targets must include at least one reference');
        }
      }
      validateTargetResult(errors, target, targetPath);
      validateReferenceIds(errors, target, 'references', targetPath, knownIds);
    }

    for (const [testIndex, test] of requireArray(errors, category, 'acceptance_tests', path, { min: 1 }).entries()) {
      const testPath = `${path}.acceptance_tests[${testIndex}]`;
      if (!requirePlainObjectValue(errors, test, testPath)) continue;
      requireString(errors, test, 'id', testPath);
      requireString(errors, test, 'type', testPath);
      if (!allowedAcceptanceResults.has(test.result)) fail(errors, `${testPath}.result`, `unknown result ${test.result}`);
      if (test.target_id && !knownIds.has(test.target_id)) fail(errors, `${testPath}.target_id`, `unknown target id ${test.target_id}`);
      const target = knownItems.get(test.target_id);
      if (target?.result === 'fail' && test.result === 'pass') {
        fail(errors, `${testPath}.result`, `cannot pass while target ${test.target_id} fails`);
      }
      validateReferenceIds(errors, test, 'references', testPath, knownIds);
    }

    for (const [claimIndex, claim] of requireArray(errors, category, 'claims', path, { min: 1 }).entries()) {
      const claimPath = `${path}.claims[${claimIndex}]`;
      if (!requirePlainObjectValue(errors, claim, claimPath)) continue;
      requireString(errors, claim, 'id', claimPath);
      if (!allowedStatuses.has(claim.status)) fail(errors, `${claimPath}.status`, `unknown status ${claim.status}`);
      requireString(errors, claim, 'statement', claimPath);
      for (const basisId of requireArray(errors, claim, 'basis', claimPath)) {
        if (!knownIds.has(basisId)) fail(errors, `${claimPath}.basis`, `unknown basis id ${basisId}`);
      }
      requireArray(errors, claim, 'limits', claimPath);
      validateReferenceIds(errors, claim, 'references', claimPath, knownIds);
    }

    for (const [evidenceIndex, evidence] of requireArray(errors, category, 'evidence', path).entries()) {
      const evidencePath = `${path}.evidence[${evidenceIndex}]`;
      if (!requirePlainObjectValue(errors, evidence, evidencePath)) continue;
      requireString(errors, evidence, 'id', evidencePath);
      if (!allowedEvidenceTypes.has(evidence.type)) fail(errors, `${evidencePath}.type`, `unknown evidence type ${evidence.type}`);
      requireString(errors, evidence, 'description', evidencePath);
      if (pathBackedEvidenceTypes.has(evidence.type)) {
        requireString(errors, evidence, 'path', evidencePath);
        if (evidence.path && !repoPathExists(evidence.path)) {
          fail(errors, `${evidencePath}.path`, `path does not exist: ${evidence.path}`);
        }
      }
      if (executableEvidenceTypes.has(evidence.type)) {
        requireString(errors, evidence, 'command', evidencePath);
        requireString(errors, evidence, 'result', evidencePath);
      }
      validateReferenceIds(errors, evidence, 'references', evidencePath, knownIds);
    }

    for (const [cardIndex, card] of requireArray(errors, category, 'summary_cards', path).entries()) {
      const cardPath = `${path}.summary_cards[${cardIndex}]`;
      if (!requirePlainObjectValue(errors, card, cardPath)) continue;
      requireString(errors, card, 'id', cardPath);
      requireString(errors, card, 'title', cardPath);
      for (const [itemIndex, item] of requireArray(errors, card, 'items', cardPath, { min: 1 }).entries()) {
        const itemPath = `${cardPath}.items[${itemIndex}]`;
        if (!requirePlainObjectValue(errors, item, itemPath)) continue;
        requireString(errors, item, 'label', itemPath);
        requireString(errors, item, 'value', itemPath);
      }
    }

    if (category.status === 'proven') {
      const failedTests = (category.acceptance_tests || []).filter((test) => test.result === 'fail');
      if (failedTests.length > 0) {
        fail(errors, `${path}.status`, `proven category cannot have failing acceptance tests: ${failedTests.map((test) => test.id).join(', ')}`);
      }
      const incompleteRequiredRubric = (category.rubric_items || []).filter((item) =>
        item.required && ['missing', 'partial'].includes(item.status)
      );
      if (incompleteRequiredRubric.length > 0) {
        fail(errors, `${path}.status`, `proven category cannot have incomplete required rubric items: ${incompleteRequiredRubric.map((item) => item.id).join(', ')}`);
      }
    }

    if (category.number === 8) {
      validateSecurityCategory(errors, category, path);
    }

    requireArray(errors, category, 'caveats', path);
    requireArray(errors, category, 'non_claims', path);
    requireArray(errors, category, 'sources', path);
  }
  return errors;
}

function validateSecurityCategory(errors, category, path) {
  const fields = category.audit_deliverable?.fields || {};
  const probeTool = category.audit_deliverable?.probe_tool || {};
  for (const key of ['command', 'fresh_instance_runbook', 'structured_report']) {
    if (typeof probeTool[key] !== 'string' || probeTool[key].trim() === '') {
      fail(errors, `${path}.audit_deliverable.probe_tool.${key}`, 'is required for Security 8');
    }
  }
  for (const key of [
    'auth_session_vulnerabilities',
    'websocket_validation_failures',
    'input_sanitization_failures',
    'dependency_cves',
    'cors_csp_misconfiguration',
    'secrets_exposure_risk',
    'rate_limiting_absent_on',
    'verbose_error_leakage',
  ]) {
    if (!(key in fields)) fail(errors, `${path}.audit_deliverable.fields.${key}`, 'is required for Security 8');
  }
  const fixProofs = category.audit_deliverable?.verified_vulnerability_fixes;
  if (!Array.isArray(fixProofs) || fixProofs.length < 2) {
    fail(errors, `${path}.audit_deliverable.verified_vulnerability_fixes`, 'must include two fix-proof slots for Security 8');
  }
}

function roundMetric(value) {
  return Number(value.toFixed(2));
}

function artifactEndpoint(endpoint) {
  return String(endpoint || '').replace(/^GET\s+/, '');
}

function validateMetricMap(errors, endpoint, endpointPath, metric, { required = false } = {}) {
  if (!(metric in endpoint)) {
    if (required) fail(errors, `${endpointPath}.${metric}`, 'is required for api_benchmark_matrix endpoints');
    return [];
  }
  if (!isPlainObject(endpoint[metric])) {
    fail(errors, `${endpointPath}.${metric}`, 'must be an object keyed by concurrency');
    return [];
  }
  const entries = Object.entries(endpoint[metric]);
  if (required && entries.length === 0) {
    fail(errors, `${endpointPath}.${metric}`, 'must not be empty');
  }
  return entries;
}

async function validateApiBenchmarkMatrix(ledger) {
  const errors = [];
  for (const [categoryIndex, category] of ledger.categories.entries()) {
    for (const [measurementIndex, measurement] of (category.measurements || []).entries()) {
      if (measurement.kind !== 'api_benchmark_matrix' || !measurement.artifact || !measurement.endpoints) continue;

      const measurementPath = `categories[${categoryIndex}].measurements[${measurementIndex}]`;
      if (!repoPathExists(measurement.artifact)) {
        fail(errors, `${measurementPath}.artifact`, `path does not exist: ${measurement.artifact}`);
        continue;
      }

      const artifact = await readJson(resolve(repoRoot, measurement.artifact));
      if (!Array.isArray(artifact.results)) {
        fail(errors, `${measurementPath}.artifact`, 'benchmark artifact must include results array');
        continue;
      }

      const rowsByEndpointAndConcurrency = new Map(
        artifact.results.map((row) => [`${row.endpoint}|${row.concurrency}`, row])
      );
      for (const [endpointIndex, endpoint] of measurement.endpoints.entries()) {
        const endpointPath = `${measurementPath}.endpoints[${endpointIndex}]`;
        if (!requirePlainObjectValue(errors, endpoint, endpointPath)) continue;
        requireString(errors, endpoint, 'endpoint', endpointPath);
        for (const metric of ['p50_ms', 'p95_ms', 'p99_ms', 'non_2xx']) {
          for (const [concurrencyKey, ledgerValue] of validateMetricMap(errors, endpoint, endpointPath, metric, {
            required: metric === 'p95_ms' || metric === 'non_2xx',
          })) {
            const match = /^(\d+)c$/.exec(concurrencyKey);
            if (!match) {
              fail(errors, `${endpointPath}.${metric}.${concurrencyKey}`, 'concurrency key must look like 10c');
              continue;
            }
            const concurrency = Number(match[1]);
            const artifactRow = rowsByEndpointAndConcurrency.get(`${artifactEndpoint(endpoint.endpoint)}|${concurrency}`);
            if (!artifactRow) {
              fail(errors, `${endpointPath}.${metric}.${concurrencyKey}`, 'missing matching artifact row');
              continue;
            }
            const artifactValue = artifactRow[metric];
            if (typeof artifactValue !== 'number') {
              fail(errors, `${endpointPath}.${metric}.${concurrencyKey}`, 'artifact value must be numeric');
              continue;
            }
            const comparableArtifactValue = metric === 'non_2xx' ? artifactValue : roundMetric(artifactValue);
            if (ledgerValue !== comparableArtifactValue) {
              fail(
                errors,
                `${endpointPath}.${metric}.${concurrencyKey}`,
                `must match ${measurement.artifact}: ledger ${ledgerValue}, artifact ${comparableArtifactValue}`
              );
            }
          }
        }
      }
    }
  }
  return errors;
}

const measurementValidators = {
  api_benchmark_matrix: validateApiBenchmarkMatrix,
};

function summarize(ledger) {
  const lines = [];
  for (const category of ledger.categories) {
    const tests = category.acceptance_tests || [];
    const failed = tests.filter((test) => test.result === 'fail');
    const warnings = tests.filter((test) => test.result === 'warn');
    const prefix = failed.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARN' : 'PASS';
    lines.push(
      `${prefix} ${category.id}: ${category.status}; ${category.rubric_items.length} rubric items; ${tests.length} acceptance tests`
    );
    for (const test of failed) {
      lines.push(`  FAIL ${test.id}`);
    }
    for (const test of warnings) {
      lines.push(`  WARN ${test.id}`);
    }
  }
  return lines;
}

function acceptanceFailures(ledger) {
  return ledger.categories.flatMap((category) =>
    (category.acceptance_tests || [])
      .filter((test) => test.result === 'fail')
      .map((test) => `${category.id}: ${test.id}`)
  );
}

const ledger = await readLedger();
await readJson(schemaPath);
const measurementErrors = [];
for (const validator of Object.values(measurementValidators)) {
  measurementErrors.push(...(await validator(ledger)));
}
const errors = [...validateLedgerShape(ledger), ...measurementErrors];
if (errors.length > 0) {
  console.error('Submission ledger validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

for (const line of summarize(ledger)) {
  console.log(line);
}

if (process.argv.includes('--fail-on-acceptance-fail')) {
  const failures = acceptanceFailures(ledger);
  if (failures.length > 0) {
    console.error('Submission ledger acceptance failures:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
}
