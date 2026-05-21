/**
 * DocumentContentCodec — boundary for Yjs ↔ TipTap JSON persistence.
 */
import * as Y from 'yjs';
import { yjsToJson, jsonToYjs, loadContentFromYjsState } from '../utils/yjsConverter.js';

export type TipTapDocJson = {
  type: 'doc';
  content: unknown[];
};

export function encodeContentState(docJson: TipTapDocJson): Uint8Array {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('default');
  jsonToYjs(doc, fragment, docJson);
  return Y.encodeStateAsUpdate(doc);
}

export function decodeContentState(yjsState: Uint8Array | Buffer): TipTapDocJson | null {
  const buf = Buffer.isBuffer(yjsState) ? yjsState : Buffer.from(yjsState);
  const loaded = loadContentFromYjsState(buf);
  if (!loaded || !Array.isArray(loaded.content)) return null;
  return { type: 'doc', content: loaded.content };
}

export function decodeFragmentToJson(fragment: Y.XmlFragment): TipTapDocJson {
  const content = yjsToJson(fragment);
  return { type: 'doc', content: content.content ?? [] };
}

export type ResolveInitialContentInput = {
  content: unknown;
  yjs_state: Buffer | Uint8Array | null;
};

export type ResolveInitialContentResult = {
  useYjsState: boolean;
  docJson: TipTapDocJson | null;
};

/**
 * Prefer stored Yjs state; fall back to TipTap JSON content for empty/new docs.
 */
function parseTipTapContent(content: unknown): TipTapDocJson | null {
  let jsonContent: unknown = content;
  if (typeof jsonContent === 'string') {
    if (jsonContent.trim().startsWith('<')) {
      return null;
    }
    try {
      jsonContent = JSON.parse(jsonContent);
    } catch {
      return null;
    }
  }
  if (
    jsonContent &&
    typeof jsonContent === 'object' &&
    (jsonContent as { type?: string }).type === 'doc' &&
    Array.isArray((jsonContent as { content?: unknown[] }).content)
  ) {
    return { type: 'doc', content: (jsonContent as { content: unknown[] }).content };
  }
  return null;
}

export function resolveInitialContent(input: ResolveInitialContentInput): ResolveInitialContentResult {
  if (input.yjs_state && input.yjs_state.length > 0) {
    const docJson = decodeContentState(input.yjs_state);
    if (docJson) {
      return { useYjsState: true, docJson };
    }
  }

  const docJson = input.content != null ? parseTipTapContent(input.content) : null;
  if (docJson) {
    return { useYjsState: false, docJson };
  }

  return { useYjsState: false, docJson: null };
}
