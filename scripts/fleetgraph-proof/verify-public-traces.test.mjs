// Verifies FleetGraph public trace proof helpers reject private or non-LangSmith evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPublicLangSmithTraceUrl,
  looksPrivateOrBroken,
  reviewerTraceUrls,
} from './verify-public-traces.mjs';

test('isPublicLangSmithTraceUrl accepts only public LangSmith links', () => {
  assert.equal(isPublicLangSmithTraceUrl('https://smith.langchain.com/public/abc/r'), true);
  assert.equal(isPublicLangSmithTraceUrl('https://smith.langchain.com/r/abc'), false);
  assert.equal(isPublicLangSmithTraceUrl('https://us.cloud.langfuse.com/project/x/traces/y'), false);
  assert.equal(isPublicLangSmithTraceUrl('http://smith.langchain.com/public/abc/r'), false);
  assert.equal(isPublicLangSmithTraceUrl('not-a-url'), false);
});

test('looksPrivateOrBroken catches obvious login and error pages', () => {
  assert.equal(looksPrivateOrBroken('<h1>Sign in</h1>'), true);
  assert.equal(looksPrivateOrBroken('404 not found'), true);
  assert.equal(looksPrivateOrBroken('<html><title>LangSmith trace</title><main>public run</main></html>'), false);
});

test('reviewerTraceUrls prefers generated reviewer test cases', () => {
  const rows = reviewerTraceUrls({
    reviewerTestCases: [{ id: 1, traceUrl: 'https://smith.langchain.com/public/abc/r' }],
    traceEvidence: {
      bySignal: {
        blocked: { traceUrl: 'https://smith.langchain.com/public/blocked/r' },
      },
    },
  });

  assert.deepEqual(rows, [{ id: 1, traceUrl: 'https://smith.langchain.com/public/abc/r' }]);
});
