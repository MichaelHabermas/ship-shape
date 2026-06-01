// TEST ONLY — hoisted ChatOpenAI mock shared by FleetGraph chat tests.
import { vi } from 'vitest';
import { synthesizeTestChatCompletion } from './chat-openai-mock.js';

const chatMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: vi.fn(class {
    invoke = chatMocks.invoke;
  }),
}));

export function resetChatOpenAIMock(): void {
  chatMocks.invoke.mockReset();
  chatMocks.invoke.mockImplementation(async (messages: Array<[string, string]>) => ({
    content: synthesizeTestChatCompletion(messages),
    usage_metadata: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
  }));
}

resetChatOpenAIMock();
