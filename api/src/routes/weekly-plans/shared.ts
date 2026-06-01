import { z } from 'zod';
export type WeeklyDocumentProperties = Record<string, unknown> & {
  person_id?: string;
  week_number?: number;
  project_id?: string;
  submitted_at?: string | null;
};

export type WeeklyPlanDocumentRow = {
  id: string;
  title: string;
  content: unknown;
  properties: WeeklyDocumentProperties | null;
  created_at: Date;
  updated_at: Date;
};

export type WeeklyPlanListRow = WeeklyPlanDocumentRow & {
  person_name: string | null;
  project_name: string | null;
};

export type WeeklyPlanContentRow = {
  id: string;
  content: unknown;
};

export type ContentHistoryRow = {
  id: string;
  old_value: string | null;
  new_value: string | null;
  created_at: Date;
  changed_by_id: string | null;
  changed_by_name: string | null;
};

export type WorkspaceSprintStartRow = {
  sprint_start_date: Date | string;
};

export type AllocatedPersonRow = {
  person_id: string;
  person_name: string | null;
  week_number: number;
};

export type WeeklyDocStatusRow = {
  person_id: string;
  week_number: number;
  id: string;
  content: unknown;
};

export function requireFirstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) {
    throw new Error('Expected query to return a row');
  }
  return row;
}

export function computeWeeklyDocumentTitle(baseTitle: string, personName: string | null | undefined): string {
  return personName ? `${baseTitle} - ${personName}` : baseTitle;
}

export function mapWeeklyPlanDocument(row: WeeklyPlanDocumentRow, personName: string | null | undefined) {
  return {
    id: row.id,
    title: computeWeeklyDocumentTitle(row.title, personName),
    document_type: 'weekly_plan' as const,
    content: row.content,
    properties: row.properties,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapWeeklyRetroDocument(row: WeeklyPlanDocumentRow, personName: string | null | undefined) {
  return {
    id: row.id,
    title: computeWeeklyDocumentTitle(row.title, personName),
    document_type: 'weekly_retro' as const,
    content: row.content,
    properties: row.properties,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapWeeklyPlanListItem(row: WeeklyPlanListRow) {
  return {
    id: row.id,
    title: computeWeeklyDocumentTitle(row.title, row.person_name),
    document_type: 'weekly_plan' as const,
    content: row.content,
    properties: row.properties,
    person_name: row.person_name,
    project_name: row.project_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapWeeklyRetroListItem(row: WeeklyPlanListRow) {
  return {
    id: row.id,
    title: computeWeeklyDocumentTitle(row.title, row.person_name),
    document_type: 'weekly_retro' as const,
    content: row.content,
    properties: row.properties,
    person_name: row.person_name,
    project_name: row.project_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapContentHistoryRow(row: ContentHistoryRow) {
  return {
    id: row.id,
    old_content: row.old_value ? (JSON.parse(row.old_value) as unknown) : null,
    new_content: row.new_value ? (JSON.parse(row.new_value) as unknown) : null,
    created_at: row.created_at,
    changed_by: row.changed_by_id ? {
      id: row.changed_by_id,
      name: row.changed_by_name,
    } : null,
  };
}

// Templates for weekly plan and retro documents
// These provide structure for users to fill in, and "done" status is based on adding content beyond the template
export const WEEKLY_PLAN_TEMPLATE = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'What I plan to accomplish this week' }]
    },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph' }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
      ]
    }
  ]
};

export const WEEKLY_RETRO_TEMPLATE = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'What I delivered this week' }]
    },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph' }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
      ]
    }
  ]
};

/** Build a retro template auto-populated with plan reference blocks */
export function buildRetroTemplateWithPlanItems(planItems: string[], planDocumentId: string): object {
  const content: unknown[] = [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'What I delivered this week' }],
    },
  ];

  // Add a planReference block + empty paragraph for each plan item
  for (let i = 0; i < planItems.length; i++) {
    content.push({
      type: 'planReference',
      attrs: {
        planItemText: planItems[i],
        planDocumentId,
        itemIndex: i,
      },
    });
    content.push({
      type: 'paragraph',
    });
  }

  // Add "Unplanned work" section
  content.push({
    type: 'heading',
    attrs: { level: 2 },
    content: [{ type: 'text', text: 'Unplanned work' }],
  });
  content.push({
    type: 'bulletList',
    content: [
      { type: 'listItem', content: [{ type: 'paragraph' }] },
      { type: 'listItem', content: [{ type: 'paragraph' }] },
      { type: 'listItem', content: [{ type: 'paragraph' }] },
    ],
  });

  return { type: 'doc', content };
}

// Schema for creating/getting a weekly plan
export const weeklyPlanSchema = z.object({
  person_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),  // Optional - legacy field, not used for uniqueness
  week_number: z.number().int().min(1),
});

/**
 * @swagger
 * /weekly-plans:
 *   post:
 *     summary: Create or get existing weekly plan document (idempotent)
 *     tags: [Weekly Plans]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - person_id
 *               - week_number
 *             properties:
 *               person_id:
 *                 type: string
 *                 format: uuid
 *               project_id:
 *                 type: string
 *                 format: uuid
 *                 description: Optional legacy field
 *               week_number:
 *                 type: integer
 *                 minimum: 1
 *     responses:
 *       200:
 *         description: Existing weekly plan document returned
 *       201:
 *         description: New weekly plan document created
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Person not found
 */
