import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn();
const credentialsMock = vi.fn();

vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  class MockBedrockRuntimeClient {
    config = {
      credentials: credentialsMock,
    };

    send = sendMock;
  }

  return {
    BedrockRuntimeClient: MockBedrockRuntimeClient,
    InvokeModelCommand: vi.fn(),
  };
});

describe('ai-analysis Bedrock guard', () => {
  beforeEach(() => {
    credentialsMock.mockRejectedValue(new Error('no credentials'));
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns ai_unavailable without invoking Bedrock when credentials are missing', async () => {
    const { analyzePlan, isAiAvailable } = await import('../ai-analysis.js');

    const samplePlanContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Complete the API integration and write unit tests.' }],
        },
      ],
    };

    expect(await isAiAvailable()).toBe(false);

    const result = await analyzePlan(samplePlanContent);

    expect(result).toEqual({ error: 'ai_unavailable' });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
