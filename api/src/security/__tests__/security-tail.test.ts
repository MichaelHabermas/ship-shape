import { describe, expect, it } from 'vitest';
import { validateCaiaIssuerUrl } from '../../services/caia.js';
import { safeRelativeReturnTo } from '../redirects.js';
import { evaluateSessionBinding } from '../session-binding.js';

describe('remaining security tail helpers', () => {
  it('rejects unsafe CAIA issuer URL shapes before discovery', async () => {
    const unsafe = [
      'http://caia.example.gov',
      'https://localhost',
      'https://127.0.0.1',
      'https://10.0.0.1',
      'https://192.168.1.1',
      'https://172.16.0.1',
      'https://169.254.169.254',
      'https://metadata.google.internal',
      'https://user:pass@caia.example.gov',
      'https://0x7f000001',
      'https://017700000001',
      'not a url',
      'https://',
    ];

    for (const issuer of unsafe) {
      await expect(validateCaiaIssuerUrl(issuer)).rejects.toThrow(/CAIA issuer URL/);
    }
  });

  it('keeps CAIA returnTo relative and same-origin', () => {
    expect(safeRelativeReturnTo('/docs/abc?panel=plan')).toBe('/docs/abc?panel=plan');
    expect(safeRelativeReturnTo('//evil.test')).toBeNull();
    expect(safeRelativeReturnTo('https://evil.test')).toBeNull();
    expect(safeRelativeReturnTo('/%5C%5Cevil.test')).toBeNull();
    expect(safeRelativeReturnTo('/%252F%252Fevil.test')).toBeNull();
    expect(safeRelativeReturnTo('/\u0000evil')).toBeNull();
  });

  it('uses risk-based session binding decisions', () => {
    expect(evaluateSessionBinding({
      storedUserAgent: 'Browser A',
      currentUserAgent: 'Browser A',
      storedIpAddress: '203.0.113.10',
      currentIpAddress: '203.0.113.10',
    })).toEqual({ level: 'ok', reasons: [] });

    expect(evaluateSessionBinding({
      storedUserAgent: 'Browser A',
      currentUserAgent: 'Browser B',
      storedIpAddress: '203.0.113.10',
      currentIpAddress: '203.0.113.10',
    })).toEqual({ level: 'deny', reasons: ['user_agent_changed'] });

    expect(evaluateSessionBinding({
      storedUserAgent: 'Browser A',
      currentUserAgent: 'Browser A',
      storedIpAddress: '203.0.113.10',
      currentIpAddress: '203.0.113.11',
    })).toEqual({ level: 'suspicious', reasons: ['ip_changed'] });
  });
});
