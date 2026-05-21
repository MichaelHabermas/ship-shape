import { describe, it, expect } from 'vitest';
import { extractHypothesisFromContent, extractDocumentMentionIds } from '@ship/shared';

/**
 * Mitigates drift between API re-exports and the canonical @ship/shared extractors.
 */
describe('shared content boundary', () => {
  it('extractHypothesisFromContent matches hypothesisBlock + legacy H2 behavior', () => {
    const blockDoc = {
      type: 'doc',
      content: [
        {
          type: 'hypothesisBlock',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Plan A' }] },
          ],
        },
      ],
    };
    expect(extractHypothesisFromContent(blockDoc)?.trim()).toBe('Plan A');

    const legacyDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hypothesis' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Legacy plan' }] },
      ],
    };
    expect(extractHypothesisFromContent(legacyDoc)?.trim()).toBe('Legacy plan');
  });

  it('extractDocumentMentionIds deduplicates document mentions', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const content = {
      type: 'doc',
      content: [
        { type: 'mention', attrs: { mentionType: 'document', id } },
        { type: 'mention', attrs: { mentionType: 'document', id } },
      ],
    };
    expect(extractDocumentMentionIds(content)).toEqual([id]);
  });
});
