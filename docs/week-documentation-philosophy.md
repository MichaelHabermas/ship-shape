# Week Documentation Philosophy

This document explains the philosophy behind Week documentation requirements in Ship.

> **Related**: See [Unified Document Model](./unified-document-model.md) for data model details and [Document Model Conventions](./document-model-conventions.md) for terminology.

## The Scientific Method for Weeks

Weeks in Ship follow the scientific method:

1. **Hypothesis (Weekly Plan)**: Before the week, document what you plan to do and what you expect to happen
2. **Experiment (The Week)**: Execute the work
3. **Conclusion (Weekly Retro)**: After the week, document what actually happened and what you learned

This isn't just process for process's sake. It's how teams learn and improve.

## Week Architecture

### Week Windows (Derived)

Weeks are **derived 7-day time windows** calculated from the workspace start date, not stored entities:

- Workspace has a `sprint_start_date` setting (historical name retained in database)
- Week 1 = days 1-7 from start date
- Week 2 = days 8-14
- All programs share the same week cadence

**Why workspace-wide cadence:**

1. **Shared rhythm**: Everyone is on the same schedule. Week of Jan 27 means the same dates for everyone.
2. **Cross-program visibility**: Easy to see what's happening across programs
3. **Simpler mental model**: No "which program's week are we talking about?"
4. **Resource allocation**: People work on multiple programs - one week timeline makes planning possible

**Why fixed 7-day duration:**

1. **Predictability**: Teams can plan around a consistent rhythm
2. **Comparability**: Week velocity can be compared across weeks
3. **Simplicity**: No debates about "should this week be shorter?"

If 7 days doesn't work for your team, the answer isn't variable week lengths - it's changing what you commit to within those 7 days.

### Week Documents (Explicit)

What IS stored is the **Week document** - one per program per week window:

```
Program (AUTH)
└── Week (AUTH's Week of Jan 27)    ← document_type: 'sprint'
    ├── Weekly Plan                  ← document_type: 'weekly_plan'
    ├── Weekly Retro                 ← document_type: 'weekly_retro'
    └── Issues (active work)
```

**Why per-program week documents:**

- Weekly Plans are specific to what a program is doing
- Weekly Retros capture program-specific learnings
- Different programs can have different focuses within the same week window

## Why Required Documentation

### The Problem with Optional Documentation

When documentation is optional, it doesn't get done. Teams that skip retrospectives:

- Repeat the same mistakes
- Don't capture institutional knowledge
- Can't demonstrate what they've accomplished
- Have no basis for improving estimates

### Accountability Model

**Only people can be held accountable, not projects.**

**Week Owner:** Every week document has an `owner_id` - the person accountable for that week's success. This is REQUIRED when creating a week. A person can only own one week per week window (across all programs), ensuring clear commitment.

**Documentation Ownership:** Every Weekly Plan and Weekly Retro document also has an owner - typically the week owner or their delegate.

This enables:

- Clear responsibility for week outcomes AND documentation
- Resource visibility (who's committed to what program this week?)
- Performance review integration (who consistently delivers? who doesn't?)
- Knowledge of who to ask about a particular week's decisions

### The Two Required Documents

#### Weekly Plan (Hypothesis)

A document with `document_type: 'weekly_plan'`, child of the Week document.

Written before or at the start of the week. Answers:

- What are we planning to do?
- What do we think will happen?
- What assumptions are we making?
- What are the risks?

The act of writing this down forces teams to think through their commitments rather than just pulling work into a week.

**Required properties:**

- `owner_id`: Who wrote this and is accountable for it

#### Weekly Retro (Conclusion)

A document with `document_type: 'weekly_retro'`, child of the Week document.

Written after the week ends. Answers:

- What did we actually do?
- How did reality compare to our hypothesis?
- What worked well?
- What should we change?

This closes the learning loop. Without it, you have activity but not improvement.

**Required properties:**

- `owner_id`: Who wrote this and is accountable for it

## Non-Blocking, But Visible

Documentation is required but not blocking. You can start the next week without completing the previous retro. However:

- **Visual indicators** make missing documentation obvious
- **Escalating urgency** (yellow → red) creates social pressure
- **Compliance reports** enable management visibility

This design respects that sometimes things get busy, while ensuring documentation doesn't silently fall through the cracks.

## Status Indicator Philosophy

### Why Escalating Colors?

The yellow → red progression gives teams grace while maintaining accountability:

**Weekly Plan:**

- Yellow (week not started): "You should do this soon"
- Red (week started): "You're already executing without a plan - this is a problem"

**Weekly Retro:**

- Gray (week active): "Not due yet - focus on the work"
- Gray (week just ended): "Due soon - start thinking about it"
- Yellow (1-6 days after): "You need to write this while it's fresh"
- Red (7+ days after): "This is now overdue - things are spiraling"

The 7-day threshold for retros (one full week) is deliberate. If you haven't written your retro by the time the next week ends, you're now two weeks behind and institutional knowledge is being lost.

### Why Not Block?

Blocking would be counterproductive:

- Sometimes there are genuine emergencies
- Blocking breeds workarounds and resentment
- The goal is learning, not compliance theater

Instead, we make non-compliance visible and let management handle it through normal performance channels.

## Issue Lifecycle During Weeks

Issues flow through the week like a conveyor belt:

```
Backlog (in Project)
    ↓ assigned to week
Active Week Work (week assignment set)
    ↓ work completed
Done (completed_at set)
```

- Issues keep their project association (which project they belong to)
- Issues gain a week assignment when pulled into active work
- The Week document serves as a container for that week's work

## Future Considerations

### Performance Review Integration

The compliance data (who completed docs, who didn't) can feed into performance reviews. This isn't punitive - it's objective evidence of who follows through on commitments.

### Templates

Both Weekly Plan and Weekly Retro have templates. This isn't to constrain thinking - it's to reduce friction. The template prompts ensure people at least consider the important questions.

## Key Principle

**The goal is learning, not compliance.** Every design decision should be evaluated against: "Does this help teams learn and improve, or is it just bureaucracy?"

## References

- [Unified Document Model](./unified-document-model.md) - Data model details
- [Document Model Conventions](./document-model-conventions.md) - Architectural decisions and terminology
