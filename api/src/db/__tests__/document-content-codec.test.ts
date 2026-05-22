import { describe, it, expect } from 'vitest';
import {
  encodeContentState,
  decodeContentState,
  resolveInitialContent,
} from '../document-content-codec.js';

describe('DocumentContentCodec', () => {
  const sampleDoc = {
    type: 'doc' as const,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Hello codec' }],
      },
    ],
  };

  it('round-trips TipTap JSON through Yjs state', () => {
    const yjsState = encodeContentState(sampleDoc);
    expect(yjsState.length).toBeGreaterThan(0);
    const decoded = decodeContentState(yjsState);
    expect(decoded?.content?.[0]).toMatchObject({
      type: 'paragraph',
    });
  });

  it('resolveInitialContent prefers yjs_state when present', () => {
    const yjsState = encodeContentState(sampleDoc);
    const resolved = resolveInitialContent({
      content: { type: 'doc', content: [] },
      yjs_state: Buffer.from(yjsState),
    });
    expect(resolved.useYjsState).toBe(true);
    expect(resolved.docJson?.content?.length).toBeGreaterThan(0);
  });

  it('resolveInitialContent falls back to JSON content', () => {
    const resolved = resolveInitialContent({
      content: sampleDoc,
      yjs_state: null,
    });
    expect(resolved.useYjsState).toBe(false);
    expect(resolved.docJson).toEqual(sampleDoc);
  });

  it('resolveInitialContent parses JSON string content', () => {
    const resolved = resolveInitialContent({
      content: JSON.stringify(sampleDoc),
      yjs_state: null,
    });
    expect(resolved.docJson).toEqual(sampleDoc);
  });

  it('resolveInitialContent skips XML-like string content', () => {
    const resolved = resolveInitialContent({
      content: '<paragraph>legacy</paragraph>',
      yjs_state: null,
    });
    expect(resolved.docJson).toBeNull();
  });

  it('resolveInitialContent falls back to JSON when yjs_state is corrupt', () => {
    const resolved = resolveInitialContent({
      content: sampleDoc,
      yjs_state: Buffer.from([0, 1, 2, 3, 4]),
    });
    expect(resolved.useYjsState).toBe(false);
    expect(resolved.docJson).toEqual(sampleDoc);
  });

  it('resolveInitialContent accepts empty doc content array', () => {
    const emptyDoc = { type: 'doc' as const, content: [] };
    const resolved = resolveInitialContent({
      content: emptyDoc,
      yjs_state: null,
    });
    expect(resolved.docJson).toEqual(emptyDoc);
  });
});
