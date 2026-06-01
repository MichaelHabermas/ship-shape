import { z } from 'zod';
import type {
  SprintReviewDocumentRow,
  SprintReviewIssueRow,
  SprintReviewSprintData,
  TipTapJsonDoc,
} from './types.js';

export function extractReviewResponseFromRow(
  review: SprintReviewDocumentRow,
  sprintId: string,
) {
  const reviewProps = review.properties || {};
  return {
    id: review.id,
    sprint_id: sprintId,
    title: review.title,
    content: review.content,
    plan_validated: reviewProps.plan_validated ?? null,
    owner_id: reviewProps.owner_id || null,
    owner_name: review.owner_name || null,
    owner_email: review.owner_email || null,
    created_at: review.created_at,
    updated_at: review.updated_at,
    is_draft: false,
  };
}

export const sprintReviewSchema = z.object({
  content: z.record(z.unknown()).optional(),
  title: z.string().max(200).optional(),
  plan_validated: z.boolean().nullable().optional(),
});

export async function generatePrefilledReviewContent(
  sprintData: SprintReviewSprintData,
  issues: SprintReviewIssueRow[],
): Promise<TipTapJsonDoc> {
  const issuesPlanned = issues.filter((i) => {
    const props = i.properties || {};
    return !props.carryover_from_sprint_id;
  });

  const issuesCompleted = issues.filter((i) => {
    const props = i.properties || {};
    return props.state === 'done';
  });

  const issuesIntroduced = issues.filter((i) => {
    const props = i.properties || {};
    return !!props.carryover_from_sprint_id;
  });

  const issuesCancelled = issues.filter((i) => {
    const props = i.properties || {};
    return props.state === 'cancelled';
  });

  const content: TipTapJsonDoc = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Weekly Summary' }],
      },
      {
        type: 'paragraph',
        content: [{
          type: 'text',
          text: `Week ${sprintData.sprint_number} review for ${sprintData.program_name || 'Program'}.`,
        }],
      },
    ],
  };

  if (sprintData.plan) {
    content.content.push(
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Plan' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: sprintData.plan }],
      },
    );
  }

  content.content.push(
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Issues Summary' }],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: `Planned: ${issuesPlanned.length} issues` }],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: `Completed: ${issuesCompleted.length} issues` }],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: `Introduced mid-sprint: ${issuesIntroduced.length} issues` }],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: `Cancelled: ${issuesCancelled.length} issues` }],
          }],
        },
      ],
    },
  );

  if (issuesCompleted.length > 0) {
    content.content.push(
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Deliverables' }],
      },
      {
        type: 'bulletList',
        content: issuesCompleted.map((i) => ({
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: `#${i.ticket_number}: ${i.title}` }],
          }],
        })),
      },
    );
  }

  content.content.push(
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Next Steps' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Add follow-up actions and learnings here.' }],
    },
  );

  return content;
}
