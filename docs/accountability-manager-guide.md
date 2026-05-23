# Ship Accountability Manager Guide

This guide explains how managers and reviewers use Ship's accountability features to ensure quality and track team progress.

> **Related**: See [Accountability Philosophy](./accountability-philosophy.md) for why these features exist and [Ship Philosophy](./ship-philosophy.md) for system overview.

## Using the Accountability Grid

The accountability grid provides a bird's-eye view of your team's pending accountability items.

### Accessing the Grid

Navigate to **Teams** > **Accountability** to see the grid view.

For a heatmap of team standups, plans, and retros, open **Status Overview** in the Teams sidebar (route: `/team/status`).

### What You See

The grid shows each team member as a row with columns for:

| Column | What It Shows |
|--------|---------------|
| **Person** | Team member name |
| **Pending Items** | Count of overdue accountability tasks |
| **Standups** | Days since last standup |
| **Hypotheses** | Unapproved week/project hypotheses |
| **Reviews** | Unapproved weekly reviews |
| **Retros** | Missing or unapproved retrospectives |

### Color Coding

- **Green**: All caught up, no action needed
- **Yellow**: Items pending but within grace period
- **Red**: Overdue items requiring attention

### Using the Grid for 1:1s

The accountability grid is useful for one-on-one meetings:

1. Review the grid before your 1:1
2. Identify any red items for discussion
3. Use specific data points ("Your last standup was 5 days ago")
4. Focus on patterns, not individual incidents

## Reviewing Week Hypotheses

Week hypotheses define what the team expects to accomplish and learn during the week.

### When to Review

Review hypotheses **before the week starts**. A week without an approved hypothesis should not begin execution.

### What to Look For

A good week hypothesis includes:

- **Clear objectives**: What will be delivered?
- **Measurable outcomes**: How will we know if we succeeded?
- **Assumptions stated**: What are we betting on?
- **Risks identified**: What could go wrong?

### Approval Workflow

1. Week owner writes the hypothesis
2. You receive notification of pending approval
3. Navigate to the week's sidebar
4. Click **Approve Hypothesis** to approve

If changes are needed:
1. Provide feedback in comments or directly to the owner
2. Wait for updates
3. Approve when satisfactory

### If Hypothesis Changes After Approval

If the week owner modifies the hypothesis after approval, the status changes to **Changed Since Approved**.

You'll see:
- **Re-approve** button (amber color)
- **View changes** link showing what changed

Review the diff and re-approve if the changes are acceptable.

## Reviewing Weekly Reviews

Weekly reviews document what was actually delivered versus what was planned.

### When to Review

Review weekly reviews **within 3 days of week end**. Fresh context makes review more valuable.

### What to Look For

A good weekly review includes:

- **Issues completed**: What shipped?
- **Carryover explained**: What didn't ship and why?
- **Blockers documented**: What slowed the team down?
- **Velocity comparison**: How does this compare to previous weeks?

### Approval Workflow

1. Navigate to the completed week
2. In the sidebar, find **Review Approval**
3. Read the review content
4. Choose one action:
   - **Approve** (optionally add an approval note)
   - **Request Changes** (requires feedback and reopens the owner's action item)
   - **Skip** (move to the next item without a decision)
5. For retros, select a **1-5 performance rating** when approving

### Common Issues to Flag

- Missing explanation for incomplete issues
- No mention of blockers or learnings
- Copy-paste from previous week (no real reflection)
- Blame language instead of process improvement

## Reviewing Project Hypotheses

Project hypotheses define the expected business outcome and how success will be measured.

### When to Review

Review project hypotheses **before significant work begins**. Projects without approved hypotheses should not consume team resources.

### What to Look For

A good project hypothesis includes:

- **Business outcome**: What value will this deliver?
- **Success metrics**: How will we measure impact?
- **Expected timeline**: When will we know if it worked?
- **ICE score rationale**: Why these Impact/Confidence/Ease scores?

### Approval Workflow

1. Navigate to the project page
2. In the sidebar, find **Approvals** section
3. Click **Approve Hypothesis** under Hypothesis row

## Reviewing Project Retrospectives

Project retrospectives determine whether the hypothesis was validated.

### When to Review

Review retrospectives **when a project is marked complete**. The retro is the final word on whether the project succeeded.

### What to Look For

A good project retro includes:

- **Validation status**: Was the hypothesis validated or invalidated?
- **Actual vs. expected impact**: Did we deliver the value we predicted?
- **Learnings captured**: What should the next team know?
- **Next steps**: What should happen based on what we learned?

### Approval Workflow

1. Navigate to the completed project
2. In the sidebar, find **Retrospective** under Approvals
3. Read the retrospective content
4. Click **Approve Retrospective** if satisfactory

### Handling Invalidated Hypotheses

An invalidated hypothesis is not a failure—it's learning. Look for:

- Honest assessment of what went wrong
- Specific learnings (not just "we'll try harder")
- Clear recommendations for future work
- No blame, just process observation

## Understanding Approval States

Each approvable item (hypothesis, review, retro) has one of three states:

### Not Approved (Initial State)

The item has never been approved. Shows as:
- **"Approve [Type]"** button in accent color
- No approval metadata

### Approved

The item has been approved and hasn't changed. Shows as:
- Green checkmark icon
- "Approved by [Name] on [Date]"
- Optional approval note (if the reviewer left one)

### Changed Since Approved

The item was approved but has been modified since. Shows as:
- Amber "Re-approve [Type]" button
- "View changes since last approval" link

This state requires your attention—the content you approved is no longer current.

### Changes Requested

The reviewer explicitly kicked the item back for revision. Shows as:
- Purple "Changes Requested" state
- Required reviewer feedback explaining what to fix
- A new action item for the owner until the item is re-approved

## Using the Diff Viewer

When content changes after approval, you can see exactly what changed.

### Accessing the Diff

1. Find an item in "Changed Since Approved" state
2. Click **View changes since last approval**
3. A modal opens showing the diff

### Reading the Diff

The diff viewer shows:
- **Removed text**: Struck through
- **Added text**: Highlighted
- **Unchanged text**: Normal formatting

### Common Scenarios

**Minor Typo Fixes**: If only typos were fixed, re-approve immediately.

**Scope Changes**: If objectives or success criteria changed, have a conversation before re-approving.

**Complete Rewrite**: If the hypothesis is fundamentally different, treat it as a new review.

## Common Workflows

### Weekly Accountability Check

Every week:

1. Open the accountability grid
2. Note any team members with red indicators
3. Check for unapproved hypotheses on active weeks
4. Review any pending weekly reviews from last week
5. Follow up on specific items in your 1:1s

### Week Kickoff Approval

At week start:

1. Week owner notifies you hypothesis is ready
2. Read the hypothesis in the week document
3. Navigate to sidebar and click **Approve Hypothesis**
4. If feedback needed, comment first, then approve when updated

### Week End Approval

After week ends:

1. Wait for week owner to complete the review
2. Read the review content
3. Navigate to sidebar and click **Approve Review**
4. Note any patterns for retrospective discussion

### Project Completion

When a project ends:

1. Ensure retrospective is written
2. Read the retro and validation status
3. Navigate to sidebar and click **Approve Retrospective**
4. Update portfolio/roadmap based on learnings

### Handling Overdue Items

When items are severely overdue (7+ days):

1. Check the accountability grid or login prompt for inferred gaps
2. Have a direct conversation with the responsible party
3. Understand blockers (real or process)
4. Get a commitment on a resolution date
5. Follow up at that date

Ship surfaces overdue accountability as inferred items — it does not auto-create issues. If a gap needs tracked follow-up, create an issue manually.

## Troubleshooting

### "I don't see the Approve button"

You need to be either:
- Assigned as **Accountable** on the document
- A **workspace admin**

If neither applies, you cannot approve this item.

### "The status says 'Changed Since Approved' but I didn't approve it"

Another approver (perhaps a previous accountable person or admin) approved it. The "Approved by" text shows who.

### "Someone approved without authority"

Check workspace admin list. Admins can approve any document. If this is a governance issue, adjust workspace admin membership.

### "Approval button is disabled"

The item has no content to approve. For hypotheses, the text must be written. For retros, a retrospective must exist.

## Best Practices

### Be Timely

Approve items within 24-48 hours when possible. Delayed approvals:
- Block team momentum
- Create approval backlog
- Reduce the value of feedback

### Be Specific

When requesting changes, be specific:
- "Add success metrics for the API integration" (good)
- "Needs more detail" (unhelpful)

### Be Consistent

Apply the same standards across the team. Inconsistent approval creates:
- Confusion about expectations
- Perception of favoritism
- Reduced trust in the process

### Focus on Outcomes

Approval isn't about perfect writing. It's about:
- Clear success criteria
- Realistic commitments
- Honest reflection

A typo-free hypothesis with vague objectives is worse than a rough hypothesis with clear metrics.

## References

- [Accountability Philosophy](./accountability-philosophy.md) - Why these features exist
- [Ship Philosophy](./ship-philosophy.md) - System design overview
- [Week Documentation Philosophy](./week-documentation-philosophy.md) - Week workflow details
