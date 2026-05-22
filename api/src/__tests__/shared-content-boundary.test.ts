import { describe, it, expect } from 'vitest';
import {
  extractHypothesisFromContent,
  extractDocumentMentionIds,
  extractPlanItemsFromContent,
} from '@ship/shared';

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

  it('extractPlanItemsFromContent collects list items and long paragraphs', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Ship auth refactor' }] },
              ],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Write retro' }] }],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Short' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Standalone plan paragraph item' }],
        },
      ],
    };
    expect(extractPlanItemsFromContent(doc)).toEqual([
      'Ship auth refactor',
      'Write retro',
      'Standalone plan paragraph item',
    ]);
  });

  it('extractPlanItemsFromContent dashboard mode keeps checked state without paragraphs', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Done task' }] },
              ],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Long paragraph not a list item' }],
        },
      ],
    };
    expect(
      extractPlanItemsFromContent(doc, { includeParagraphs: false, withChecked: true })
    ).toEqual([{ text: 'Done task', checked: true }]);
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
