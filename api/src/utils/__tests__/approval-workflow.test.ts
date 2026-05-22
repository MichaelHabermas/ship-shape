import { describe, expect, it } from 'vitest';
import { asApprovalRecord } from '../approval-workflow.js';

describe('approval workflow parsing', () => {
  it('accepts persisted approval records with nullable optional fields', () => {
    expect(asApprovalRecord({
      state: 'approved',
      approved_by: 'user-1',
      approved_at: '2026-05-22T00:00:00.000Z',
      approved_version_id: 42,
      feedback: null,
      comment: 'Looks good',
    })).toEqual({
      state: 'approved',
      approved_by: 'user-1',
      approved_at: '2026-05-22T00:00:00.000Z',
      approved_version_id: 42,
      feedback: null,
      comment: 'Looks good',
    });
  });

  it('normalizes partial legacy approval records', () => {
    expect(asApprovalRecord({
      state: 'changes_requested',
      feedback: 'Add evidence',
    })).toEqual({
      state: 'changes_requested',
      approved_by: null,
      approved_at: null,
      approved_version_id: null,
      feedback: 'Add evidence',
    });
  });

  it('rejects malformed approval-shaped values', () => {
    expect(asApprovalRecord(null)).toBeNull();
    expect(asApprovalRecord({})).toBeNull();
    expect(asApprovalRecord({ state: 'not-real' })).toBeNull();
    expect(asApprovalRecord({ state: 'approved', approved_version_id: '42' })).toBeNull();
    expect(asApprovalRecord({ state: 'approved', approved_by: 123 })).toBeNull();
  });
});
