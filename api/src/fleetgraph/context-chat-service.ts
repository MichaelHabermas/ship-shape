// Context chat service resolves page/finding bundles and model answers behind one boundary.
import type { Principal } from '../security/principal.js';
import type { FleetGraphPersistencePort } from './core.js';
import type { ContextChatResolveOptions } from './runtime/context-chat.js';
import {
  chatModelAnswerFromContext,
  contextTextForModel,
  resolveContextChatBundle,
  type ContextChatBundle,
} from './runtime/context-chat.js';

export type FleetGraphContextChatResolveInput = Parameters<typeof resolveContextChatBundle>[0];

export async function resolveFleetGraphContextChatBundle(
  input: FleetGraphContextChatResolveInput,
  persistence: FleetGraphPersistencePort,
  options: ContextChatResolveOptions = {},
): Promise<ContextChatBundle> {
  return resolveContextChatBundle(input, persistence, options);
}

export function contextChatTextForModel(bundle: ContextChatBundle): string {
  return contextTextForModel(bundle);
}

export function contextChatModelAnswer(body: string, bundle: ContextChatBundle) {
  return chatModelAnswerFromContext(body, bundle);
}

export type { ContextChatBundle };
