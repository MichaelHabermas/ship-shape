# Ship Accountability Philosophy

This document explains Ship's approach to accountability and why it matters for effective team execution.

> **Related**: See [Ship Philosophy](./ship-philosophy.md) for the overall system design and [Week Documentation Philosophy](./week-documentation-philosophy.md) for week-specific details.

## Why Accountability

Accountability is often confused with blame. In Ship, accountability means **clarity about who is responsible for outcomes** and **visibility into whether commitments are being met**.

Without accountability:
- Deadlines slip and nobody knows why
- Documentation is always "almost done"
- Retros get skipped because "we're too busy"
- Teams repeat the same mistakes week after week

With accountability:
- Clear ownership means clear expectations
- Missing documentation is visible, not hidden
- Learning happens because reflection is required
- Teams improve over time

**The goal isn't punishment. The goal is learning.**

## Hypothesis-Driven Development

Ship treats every project and week as a scientific experiment:

1. **Hypothesis**: Before starting, write down what you expect to happen
2. **Experiment**: Execute the work
3. **Conclusion**: Document what actually happened

This isn't bureaucracy—it's how teams learn.

### Why Hypotheses Matter

Teams that skip hypotheses:
- Start work without clear success criteria
- Can't tell if they succeeded or failed
- Declare "partial success" on everything
- Never know if their intuition is right

Teams that write hypotheses:
- Know exactly what success looks like
- Can objectively measure outcomes
- Build pattern recognition over time
- Get better at estimation and planning

### Binary Validation

Ship forces binary outcomes: **validated** or **invalidated**. There is no "partially validated."

This prevents:
- Moving goalposts after the fact
- Rationalizing failures as successes
- Avoiding accountability through ambiguity

If a hypothesis is invalidated, that's valuable information. Learning why something didn't work is often more valuable than accidentally succeeding.

## The Standup Ritual

Standups in Ship are asynchronous written updates. They serve three purposes:

### 1. Progress Visibility

Written standups create a searchable record of what's happening. Anyone can see:
- What work was completed
- What's planned next
- What blockers exist

This eliminates the "I didn't know that was happening" problem.

### 2. Personal Accountability

Writing down your commitments creates psychological accountability. It's harder to let things slip when you've publicly stated what you're going to do.

### 3. Cross-Time-Zone Collaboration

Unlike synchronous standups, written updates work for distributed teams. Someone in Tokyo and someone in New York can both participate without anyone waking up at 3am.

### Standup Frequency

Ship encourages regular standups but doesn't enforce a specific frequency. However:
- Week owners have a responsibility to ensure their team is posting updates
- Prolonged silence is visible and creates accountability
- The system shows when the last standup was posted

## Weekly Reviews and Retros

Weeks end with two documents that close the learning loop:

### Weekly Review (Weekly)

A weekly review answers: **What did we actually deliver?**

- Issues completed vs. what the plan declared
- What was not completed and why
- Any scope changes or surprises

This is execution tracking—did we do what we said we'd do?

### Weekly Retro (Weekly)

A weekly retro answers: **What did we learn?**

- What worked well?
- What should we change?
- Are our estimates improving?

This is process improvement—are we getting better over time?

### Project Retro (End of Project)

A project retro answers: **Was the hypothesis validated?**

- Did we achieve the stated outcome?
- What was the actual impact vs. expected?
- What should the next team know?

This is outcome measurement—did the bet pay off?

## RACI Assignments

Ship uses the RACI model for clear accountability:

| Role | Description |
|------|-------------|
| **R** - Responsible | Does the work |
| **A** - Accountable | Approves and is answerable for the outcome |
| **C** - Consulted | Provides input before decisions |
| **I** - Informed | Kept up to date on progress |

### Why RACI Matters

The most important distinction is **Responsible vs. Accountable**:

- **Responsible (Owner)**: The person doing the work. A project can have multiple contributors, but one person owns it.
- **Accountable (Approver)**: The person who must approve key decisions. Usually a manager, tech lead, or senior stakeholder.

Without this distinction:
- Work gets done but never reviewed
- Quality varies wildly
- Senior input happens too late to matter
- Nobody feels ownership of outcomes

### What Gets Approved

In Ship, the Accountable person must approve:

| Document | What's Approved |
|----------|-----------------|
| Week | Hypothesis (before week starts) |
| Week | Review (after week ends) |
| Project | Hypothesis (before project starts) |
| Project | Retrospective (after project ends) |

Approval creates:
- **Quality gates**: Work is reviewed before it's considered complete
- **Teaching moments**: Approvers can provide feedback
- **Audit trail**: Who approved what, when

## How Ship Enforces Accountability

Ship doesn't block work for missing documentation. Instead, it makes gaps visible and escalates urgency over time.

### Visual Indicators

Missing documentation shows as status indicators:
- **Gray**: Not yet due
- **Yellow**: Should be done soon
- **Red**: Overdue and needs attention

These indicators appear:
- In the week list
- On project cards
- In the accountability grid (for managers)

### Action Items on Login

When a user has overdue accountability items (missed standups, unapproved hypotheses, missing retros), Ship:

1. Shows a modal on login listing all pending items
2. Displays a persistent banner until items are addressed
3. Links directly to each item for quick action

This creates gentle but persistent pressure to complete accountability tasks.

### Inference-Only Detection

Ship detects accountability gaps at login and in the accountability grid, but does not create issues automatically. Missing standups, unapproved hypotheses, and overdue retros surface as inferred action items with synthetic IDs — visible prompts that link directly to the document needing attention.

This keeps accountability visible without polluting the issue tracker with system-generated noise. Managers and owners decide when a gap warrants a real tracked issue.

### The Accountability Grid

Managers see an accountability grid showing:
- All team members
- Their pending accountability items
- Days overdue for each item

This enables proactive management conversations rather than surprise discoveries during reviews.

## Philosophy Summary

Ship's accountability system is built on these principles:

1. **Visibility over blocking**: Make gaps obvious, don't prevent work
2. **Escalating urgency**: Start soft, get more insistent over time
3. **People own outcomes**: Only humans can be accountable
4. **Learning is the goal**: Accountability enables improvement
5. **Binary validation**: No partial success, no ambiguity

The system is intentionally "noisy." It's supposed to create friction when accountability slips. This is a feature, not a bug.

Teams that embrace the friction improve over time. Teams that resist it stay stuck.

## References

- [Ship Philosophy](./ship-philosophy.md) - System design and hierarchy
- [Week Documentation Philosophy](./week-documentation-philosophy.md) - Week workflow details
- [Accountability Manager Guide](./accountability-manager-guide.md) - How to use approval workflows
