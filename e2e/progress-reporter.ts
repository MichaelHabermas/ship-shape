/**
 * Custom Playwright Reporter for Progress Tracking
 *
 * Writes minimal progress updates to JSONL file for live monitoring.
 * Errors are written to separate files to avoid output explosion.
 *
 * Progress file: ${E2E_RESULTS_DIR:-test-results}/progress.jsonl
 * Error logs: ${E2E_RESULTS_DIR:-test-results}/errors/{test-file}.log
 */

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';

interface ProgressEntry {
  test: string;
  title: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  ts: number;
  duration?: number;
  error?: string;
}

const RESULTS_DIR = process.env.E2E_RESULTS_DIR ?? 'test-results';
const PROGRESS_FILE = path.join(RESULTS_DIR, 'progress.jsonl');
const ERRORS_DIR = path.join(RESULTS_DIR, 'errors');

const SUMMARY_FILE = path.join(RESULTS_DIR, 'summary.json');

class ProgressReporter implements Reporter {
  private totalTests = 0;
  private testStatuses = new Map<string, 'passed' | 'failed' | 'skipped'>();

  onBegin(config: FullConfig, suite: Suite): void {
    // Ensure directories exist
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.mkdirSync(ERRORS_DIR, { recursive: true });

    // Clear previous progress file
    fs.writeFileSync(PROGRESS_FILE, '');

    // Count all tests and write initial pending entries
    const allTests = this.collectTests(suite);
    this.totalTests = allTests.length;

    for (const test of allTests) {
      this.writeProgress({
        test: this.getTestFile(test),
        title: test.title,
        status: 'pending',
        ts: Date.now(),
      });
    }

    // Initialize summary with total count (only main process does this)
    if (this.totalTests > 0) {
      fs.writeFileSync(
        SUMMARY_FILE,
        JSON.stringify({
          total: this.totalTests,
          passed: 0,
          failed: 0,
          skipped: 0,
          pending: this.totalTests,
          ts: Date.now(),
        }, null, 2)
      );
    }
  }

  onTestBegin(test: TestCase): void {
    this.writeProgress({
      test: this.getTestFile(test),
      title: test.title,
      status: 'running',
      ts: Date.now(),
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const testFile = this.getTestFile(test);
    const status = this.mapStatus(result.status);

    const entry: ProgressEntry = {
      test: testFile,
      title: test.title,
      status,
      ts: Date.now(),
      duration: result.duration,
    };

    // For failures, write error to separate file
    if (status === 'failed' && result.errors.length > 0) {
      const errorFile = this.writeErrorLog(test, result);
      entry.error = errorFile;
    }

    this.writeProgress(entry);

    // Atomically update summary counters (read-modify-write)
    this.updateSummaryCounter(test.id, status);
  }

  onEnd(result: FullResult): void {
    // Write final summary
    this.writeProgress({
      test: '__summary__',
      title: 'Final Results',
      status: result.status === 'passed' ? 'passed' : 'failed',
      ts: Date.now(),
    });
  }

  private updateSummaryCounter(testId: string, status: 'passed' | 'failed' | 'skipped'): void {
    try {
      const data = fs.readFileSync(SUMMARY_FILE, 'utf-8');
      const summary = JSON.parse(data);
      const previousStatus = this.testStatuses.get(testId);

      if (previousStatus === status) {
        summary.ts = Date.now();
        fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
        return;
      }

      if (previousStatus === 'passed') summary.passed--;
      else if (previousStatus === 'failed') summary.failed--;
      else if (previousStatus === 'skipped') summary.skipped--;

      if (status === 'passed') summary.passed++;
      else if (status === 'failed') summary.failed++;
      else if (status === 'skipped') summary.skipped++;

      this.testStatuses.set(testId, status);
      summary.pending = summary.total - summary.passed - summary.failed - summary.skipped;
      summary.ts = Date.now();

      fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
    } catch {
      // Ignore errors - file might not exist yet or race condition
    }
  }

  private collectTests(suite: Suite): TestCase[] {
    const tests: TestCase[] = [];
    for (const test of suite.allTests()) {
      tests.push(test);
    }
    return tests;
  }

  private getTestFile(test: TestCase): string {
    // Get relative path from project root
    const fullPath = test.location.file;
    const match = fullPath.match(/e2e\/(.+)$/);
    return match ? match[1] : path.basename(fullPath);
  }

  private mapStatus(
    status: TestResult['status']
  ): 'passed' | 'failed' | 'skipped' {
    switch (status) {
      case 'passed':
        return 'passed';
      case 'failed':
      case 'timedOut':
      case 'interrupted':
        return 'failed';
      case 'skipped':
        return 'skipped';
      default:
        return 'failed';
    }
  }

  private writeProgress(entry: ProgressEntry): void {
    fs.appendFileSync(PROGRESS_FILE, JSON.stringify(entry) + '\n');
  }

  private writeErrorLog(test: TestCase, result: TestResult): string {
    const testFile = this.getTestFile(test);
    const safeFileName = testFile.replace(/[/\\]/g, '_').replace('.ts', '');
    const safeTitle = test.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
    const errorFileName = `${safeFileName}__${safeTitle}.log`;
    const errorPath = path.join(ERRORS_DIR, errorFileName);

    const errorContent = [
      `Test: ${testFile}`,
      `Title: ${test.title}`,
      `Duration: ${result.duration}ms`,
      ``,
      `--- Errors ---`,
      ...result.errors.map((e) => e.message || String(e)),
      ``,
      `--- Stack ---`,
      ...result.errors.map((e) => e.stack || ''),
    ].join('\n');

    fs.writeFileSync(errorPath, errorContent);
    return errorFileName;
  }
}

export default ProgressReporter;
