import { describe, expect, it } from 'vitest';
import {
  findForbiddenGovernanceKeys,
  findForbiddenRaciKeys,
  stampWeeklyAccountabilitySubmittedAt,
  stripForbiddenGovernanceKeys,
} from './document-governance.js';

describe('document-governance', () => {
  it('detects forbidden governance keys in patch payloads', () => {
    expect(
      findForbiddenGovernanceKeys({
        plan_approval: { state: 'approved' },
        title: 'ok',
      })
    ).toEqual(['plan_approval']);
  });

  it('detects submitted_at as a forbidden governance key', () => {
    expect(
      findForbiddenGovernanceKeys({
        submitted_at: '2026-01-01T00:00:00.000Z',
      })
    ).toEqual(['submitted_at']);
  });

  it('stamps submitted_at on first weekly plan content save only', () => {
    const before = { person_id: 'p1', week_number: 1 };
    const stamped = stampWeeklyAccountabilitySubmittedAt('weekly_plan', before, true);
    expect(stamped.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const again = stampWeeklyAccountabilitySubmittedAt('weekly_plan', stamped, true);
    expect(again.submitted_at).toBe(stamped.submitted_at);
    expect(stampWeeklyAccountabilitySubmittedAt('wiki', before, true)).toBe(before);
    expect(stampWeeklyAccountabilitySubmittedAt('weekly_plan', before, false)).toBe(before);
  });

  it('strips forbidden governance keys on merge', () => {
    const props = stripForbiddenGovernanceKeys({
      plan_approval: { state: 'approved' },
      owner_id: 'person-1',
    });
    expect(props).toEqual({ owner_id: 'person-1' });
  });

  it('detects RACI keys in properties payloads', () => {
    expect(findForbiddenRaciKeys({ accountable_id: 'person-1' })).toEqual(['accountable_id']);
  });
});
