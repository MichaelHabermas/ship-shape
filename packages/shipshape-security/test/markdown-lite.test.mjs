import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml } from '../src/core/markdown-lite.mjs';

test('markdownToHtml escapes script tags', () => {
  const html = markdownToHtml('<script>alert(1)</script>');
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
});

test('markdownToHtml renders list items', () => {
  const html = markdownToHtml('- one\n- two');
  assert.match(html, /<ul>/);
  assert.match(html, /<li>one<\/li>/);
});
