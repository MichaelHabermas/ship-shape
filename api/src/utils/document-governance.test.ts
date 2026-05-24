import { describe, expect, it } from 'vitest';
import {
  findForbiddenGovernanceKeys,
  findForbiddenRaciKeys,
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

  it('strips forbidden keys for non-admin merges', () => {
    const props = stripForbiddenGovernanceKeys(
      {
        plan_approval: { state: 'approved' },
        owner_id: 'person-1',
      },
      { isAdmin: false }
    );
    expect(props).toEqual({ owner_id: 'person-1' });
  });

  it('detects RACI keys in properties payloads', () => {
    expect(findForbiddenRaciKeys({ accountable_id: 'person-1' })).toEqual(['accountable_id']);
  });

  it('preserves governance keys for admins', () => {
    const props = stripForbiddenGovernanceKeys(
      { plan_approval: { state: 'approved' } },
      { isAdmin: true }
    );
    expect(props.plan_approval).toEqual({ state: 'approved' });
  });
});
