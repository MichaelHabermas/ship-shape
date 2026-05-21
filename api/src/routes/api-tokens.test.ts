import { describe, it, expect, vi } from 'vitest';

// Mock pool before importing routes
vi.mock('../db/client.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

// Mock audit service
vi.mock('../services/audit.js', () => ({
  logAuditEvent: vi.fn(),
}));

import { hashToken } from './api-tokens.js';

describe('API Tokens', () => {
  describe('hashToken', () => {
    it('returns consistent hash for same input', () => {
      const token = 'ship_abc123';
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);
      expect(hash1).toBe(hash2);
    });

    it('returns different hash for different input', () => {
      const hash1 = hashToken('ship_abc123');
      const hash2 = hashToken('ship_def456');
      expect(hash1).not.toBe(hash2);
    });

    it('returns 64-character hex string (SHA-256)', () => {
      const hash = hashToken('ship_testtoken');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('is deterministic for token validation', () => {
      // This is how we validate tokens - hash the incoming token and compare to stored hash
      const originalToken = 'ship_secrettoken123';
      const storedHash = hashToken(originalToken);

      // User submits their token
      const submittedToken = 'ship_secrettoken123';
      const submittedHash = hashToken(submittedToken);

      expect(storedHash).toBe(submittedHash);
    });
  });
});
