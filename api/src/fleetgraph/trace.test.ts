// Verifies FleetGraph trace metadata sanitizer only emits allowlisted reviewer-safe fields.
import { describe, expect, it } from 'vitest';
import { sanitizeFleetGraphTraceMetadata } from './trace.js';

describe('FleetGraph trace metadata sanitizer', () => {
  it('allows reviewer-safe trace metadata', () => {
    expect(sanitizeFleetGraphTraceMetadata({
      mode: 'on_demand',
      decision: 'explain',
      nodePath: ['normalizeTrigger', 'produceOutput'],
      traceId: 'trace-123',
    })).toEqual({
      mode: 'on_demand',
      decision: 'explain',
      nodePath: ['normalizeTrigger', 'produceOutput'],
      traceId: 'trace-123',
    });
  });

  it('drops raw prompt/completion/token-style keys, nested objects, and emails', () => {
    expect(sanitizeFleetGraphTraceMetadata({
      mode: 'on_demand',
      decision: 'explain',
      nodePath: ['produceOutput'],
      rawPrompt: 'secret',
      owner: 'person@example.com',
      nested: { completion: 'secret' },
      trace: [{ token: 'secret' }],
    })).toEqual({
      mode: 'on_demand',
      decision: 'explain',
      nodePath: ['produceOutput'],
    });
  });

  it('drops unsafe trace URLs', () => {
    expect(sanitizeFleetGraphTraceMetadata({
      mode: 'on_demand',
      decision: 'explain',
      nodePath: ['produceOutput'],
      traceUrl: 'javascript:alert(1)',
    })).toEqual({
      mode: 'on_demand',
      decision: 'explain',
      nodePath: ['produceOutput'],
    });
  });

  it('allows known provider trace URLs without allowing lookalike hosts', () => {
    expect(sanitizeFleetGraphTraceMetadata({
      mode: 'proactive',
      decision: 'create_finding',
      nodePath: ['normalizeTrigger', 'produceOutput'],
      traceUrl: 'https://smith.langchain.com/public/trace-id/r',
    })).toMatchObject({
      traceUrl: 'https://smith.langchain.com/public/trace-id/r',
    });

    expect(sanitizeFleetGraphTraceMetadata({
      mode: 'proactive',
      decision: 'create_finding',
      nodePath: ['normalizeTrigger', 'produceOutput'],
      traceUrl: 'https://us.cloud.langfuse.com/project/project-id/traces/trace-id',
    })).toMatchObject({
      traceUrl: 'https://us.cloud.langfuse.com/project/project-id/traces/trace-id',
    });

    expect(sanitizeFleetGraphTraceMetadata({
      mode: 'proactive',
      decision: 'create_finding',
      nodePath: ['normalizeTrigger', 'produceOutput'],
      traceUrl: 'https://evilsmith.langchain.com/public/trace-id/r',
    })).not.toHaveProperty('traceUrl');

    expect(sanitizeFleetGraphTraceMetadata({
      mode: 'proactive',
      decision: 'create_finding',
      nodePath: ['normalizeTrigger', 'produceOutput'],
      traceUrl: 'https://cloud.langfuse.com.evil.example/project/project-id/traces/trace-id',
    })).not.toHaveProperty('traceUrl');
  });
});
