import { describe, expect, it } from 'vitest';
import type { DocumentResponse } from './document-tabs';
import {
  getDocumentProgramId,
  mapApiDocumentToUnifiedDocumentView,
} from './document-view-mapper';

describe('document view mapper', () => {
  it('maps issue associations from belongs_to only', () => {
    const document: DocumentResponse = {
      id: 'issue-1',
      title: 'Issue',
      document_type: 'issue',
      program_id: 'legacy-program',
      sprint_id: 'legacy-sprint',
      state: 'todo',
      priority: 'high',
      ticket_number: 42,
      belongs_to: [
        { id: 'program-1', type: 'program', title: 'Program' },
        { id: 'sprint-1', type: 'sprint', title: 'Week' },
        { id: 'bad-1', type: 'bad-type' },
      ],
    };

    const view = mapApiDocumentToUnifiedDocumentView(document);

    expect(view).not.toBeNull();
    if (!view) {
      throw new Error('expected mapped view');
    }
    expect(view.document_type).toBe('issue');
    if (!('program_id' in view) || !('sprint_id' in view) || !('belongs_to' in view)) {
      throw new Error('expected issue view');
    }
    expect(view.program_id).toBe('program-1');
    expect(view.sprint_id).toBe('sprint-1');
    expect(view.display_id).toBe('#42');
    expect(view.belongs_to).toEqual([
      { id: 'program-1', type: 'program', title: 'Program' },
      { id: 'sprint-1', type: 'sprint', title: 'Week' },
    ]);
  });

  it('maps project program_id from belongs_to rather than legacy fields', () => {
    const document: DocumentResponse = {
      id: 'project-1',
      title: 'Project',
      document_type: 'project',
      program_id: 'legacy-program',
      belongs_to: [{ id: 'program-1', type: 'program' }],
      consulted_ids: ['person-1', 123],
    };

    const view = mapApiDocumentToUnifiedDocumentView(document);

    expect(view).not.toBeNull();
    if (!view) {
      throw new Error('expected mapped view');
    }
    expect(view.document_type).toBe('project');
    if (!('program_id' in view) || !('consulted_ids' in view)) {
      throw new Error('expected project view');
    }
    expect(view.program_id).toBe('program-1');
    expect(view.consulted_ids).toEqual(['person-1']);
  });

  it('returns null for missing association ids', () => {
    expect(getDocumentProgramId({ id: 'x', title: 'x', document_type: 'issue', belongs_to: undefined })).toBeNull();
    expect(
      getDocumentProgramId({
        id: 'x',
        title: 'x',
        document_type: 'issue',
        belongs_to: [{ id: 'project-1', type: 'project' }],
      }),
    ).toBeNull();
  });

  it('preserves standup document type instead of remapping it to wiki', () => {
    const view = mapApiDocumentToUnifiedDocumentView({
      id: 'standup-1',
      title: 'Standup',
      document_type: 'standup',
    });

    expect(view).not.toBeNull();
    expect(view?.document_type).toBe('standup');
  });

  it('returns null for truly unknown document types', () => {
    const view = mapApiDocumentToUnifiedDocumentView({
      id: 'unknown-1',
      title: 'Unknown',
      document_type: 'not-a-document-type',
    });

    expect(view).toBeNull();
  });
});
