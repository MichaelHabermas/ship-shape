# AI Methodology Analysis

## Scope

This analysis used Ship Shape repo artifacts plus local agent session history across Claude, Codex, and Cursor. The session-history scan processed 1,419 Ship Shape session files, found 720 broad AI/project matches and 613 process/evidence/security/FleetGraph matches, with no parse errors. Representative deep dives included Codex root sessions, guardian review sessions, and a Cursor security implementation session.

Repo artifacts reviewed included:

- `my-docs/AI_COST_ANALYSIS.md`
- `my-docs/MEMORY.md`
- `my-docs/project-weeks-sot/week-4/DECISION_LOG.md`
- `my-docs/project-weeks-sot/week-5/IMPLEMENTATION_PLAN_MVP.md`
- `my-docs/project-weeks-sot/week-5/DECISION_LOG-w5.md`

## Core Methodology

The actual methodology is not "use AI to code faster." It is closer to:

**AI as an adversarial audit and evidence-production system.**

The recurring loop is:

1. Anchor to source-of-truth docs.
2. Split context into specialist lenses.
3. Let agents explore or review in parallel.
4. Collapse findings into a bounded plan.
5. Implement narrowly.
6. Verify with commands, probes, generated artifacts, and evidence ledgers.
7. Record durable decisions so future agents do not rediscover the same thing.

The strongest operating pattern is **source truth first, code second, claims last**. The workflow repeatedly distinguishes "we changed code" from "we can prove the claim." Category 8 security work is the clearest example: findings close through probe or focused-test evidence, not code inspection. FleetGraph repeats the pattern: deterministic SQL candidate selection before LLM reasoning, worker disabled by default, zero-token empty ticks, and a human gate before mutation.

The second strong pattern is **agent specialization as pressure testing, not delegation theater**. Subagents are most useful when assigned independent failure modes: architecture, security, deployment, design, scope, reviewer proof, and adversarial review. The parent remains responsible for synthesis and final judgment.

The third strong pattern is **turning chaos into rails**. One-off discoveries become repo mechanics: `shipshape-security`, submission ledger checks, reviewer evidence bundles, E2E profiling, feature-branch sync, context manifests, memory rules, and decision logs.

## Where It Works

This methodology is excellent for:

- Audit-heavy projects.
- Security hardening.
- Reviewer-facing proof.
- Large inherited codebases.
- Ambiguous assignments where the grading surface matters.
- Architecture cleanup where hidden coupling is the danger.

Ship Shape benefited because the project rewarded comprehension, measured improvement, and proof. The workflow found hidden risks, built reusable probes, and turned evidence into reviewable artifacts. `AI_COST_ANALYSIS.md` says the same thing plainly: Codex was most effective as an audit accelerator over an existing codebase, not as a greenfield app generator.

## Where It Burns Motion

The main weakness is context cost.

The cost report measured 228 Codex threads and 840,789,734 local tokens over the 2026-05-18 to 2026-05-21 window. That is not inherently bad, but it shows the failure mode: broad context gets reloaded across adjacent planning and review loops. The sessions also show repeated "spin up varied agents, make a detailed plan" patterns. Useful once; expensive when repeated after rails already exist.

The workflow also tends to preserve too much meta-work until later cleanup rules prune it. The repo now explicitly warns that generated bundles, temporary orchestration plans, and stale evidence runs become false authorities. That warning exists because the methodology produced the problem before it solved it.

Sharp critique: the process is sometimes better at **proving work** than deciding **what not to do**. Week 4 improved this with Evidence Freeze and packaging reviewer evidence instead of reopening implementation. That move should happen earlier.

## Keep

Keep this skeleton:

1. Source truth.
2. Smallest matching context profile.
3. Specialist review only when risk warrants it.
4. Bounded plan.
5. Narrow implementation.
6. Command evidence.
7. Decision log.
8. Memory only for durable traps.

This is the strongest part of the system.

## Delete

Delete default broad-agent fanout.

Use agents when the task has independent uncertainty lanes: security, data model, UX, deployment, performance, reviewer proof. Do not use agents for simple implementation or when the parent must hold the reasoning. The repo's own agent guidance says this, and the session history supports it.

## 10x Improvement

Build a reusable methodology harness for Ship Shape-style work.

Example:

```bash
pnpm agent:brief <slice>
```

The command would print:

- Source truth for the slice.
- Selected context profile.
- Non-negotiables.
- Allowed files or boundaries.
- Verification commands.
- Claim boundary.
- Previous relevant decisions.

That would cut token burn, reduce drift, and make the best habit automatic: every AI pass starts with the same truth boundary and ends with evidence, not vibes.

## Bottom Line

The methodology is unusually strong when the job is high-context, high-proof, and adversarial. Its weakness is cost and ceremony. The next level is making the rails cheap enough that a heroic orchestration loop is not required every time.
