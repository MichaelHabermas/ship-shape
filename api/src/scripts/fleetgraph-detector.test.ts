// Verifies FleetGraph detector CLI argument parsing before manual validation runs.
import { describe, expect, it } from 'vitest';
import { parseFleetGraphDetectorCliArgs } from './fleetgraph-detector.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';

describe('FleetGraph detector CLI args', () => {
  it('requires a workspace id', () => {
    expect(parseFleetGraphDetectorCliArgs([])).toEqual({
      ok: false,
      error: expect.stringContaining('--workspace-id <uuid>') as unknown,
    });
  });

  it('parses valid optional today and limit values', () => {
    const parsed = parseFleetGraphDetectorCliArgs([
      '--workspace-id',
      workspaceId,
      '--today',
      '2026-05-26',
      '--limit',
      '3',
    ]);

    expect(parsed).toEqual({
      ok: true,
      workspaceId,
      today: new Date('2026-05-26T00:00:00.000Z'),
      limit: 3,
    });
  });

  it('rejects invalid calendar dates instead of letting JavaScript normalize them', () => {
    expect(parseFleetGraphDetectorCliArgs([
      '--workspace-id',
      workspaceId,
      '--today',
      '2026-02-31',
    ])).toEqual({
      ok: false,
      error: 'Invalid --today value: 2026-02-31',
    });
  });

  it('rejects invalid limits', () => {
    expect(parseFleetGraphDetectorCliArgs([
      '--workspace-id',
      workspaceId,
      '--limit',
      '0',
    ])).toEqual({
      ok: false,
      error: 'Invalid --limit value: 0',
    });
  });

  it('rejects missing values that would otherwise be read as another flag', () => {
    expect(parseFleetGraphDetectorCliArgs([
      '--workspace-id',
      '--today',
      '2026-05-26',
    ])).toEqual({
      ok: false,
      error: expect.stringContaining('--workspace-id <uuid>') as unknown,
    });

    expect(parseFleetGraphDetectorCliArgs([
      '--workspace-id',
      workspaceId,
      '--limit',
    ])).toEqual({
      ok: false,
      error: 'Missing --limit value',
    });
  });

  it('rejects partially numeric limits', () => {
    expect(parseFleetGraphDetectorCliArgs([
      '--workspace-id',
      workspaceId,
      '--limit',
      '3abc',
    ])).toEqual({
      ok: false,
      error: 'Invalid --limit value: 3abc',
    });

    expect(parseFleetGraphDetectorCliArgs([
      '--workspace-id',
      workspaceId,
      '--limit',
      '3.5',
    ])).toEqual({
      ok: false,
      error: 'Invalid --limit value: 3.5',
    });
  });

  it('rejects malformed workspace ids, unknown flags, duplicate flags, and trailing garbage', () => {
    expect(parseFleetGraphDetectorCliArgs([
      '--workspace-id',
      'not-a-uuid',
    ])).toEqual({
      ok: false,
      error: 'Invalid --workspace-id value: not-a-uuid',
    });

    expect(parseFleetGraphDetectorCliArgs([
      '--workspace-id',
      workspaceId,
      '--bogus',
      'value',
    ])).toEqual({
      ok: false,
      error: 'Unknown option: --bogus',
    });

    expect(parseFleetGraphDetectorCliArgs([
      '--workspace-id',
      workspaceId,
      '--workspace-id',
      workspaceId,
    ])).toEqual({
      ok: false,
      error: 'Duplicate option: --workspace-id',
    });

    expect(parseFleetGraphDetectorCliArgs([
      '--workspace-id',
      workspaceId,
      'extra',
    ])).toEqual({
      ok: false,
      error: 'Unexpected argument: extra',
    });
  });
});
