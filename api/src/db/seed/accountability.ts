import { IdRow } from '../../test/pg-result.js';
import { seedAt, SeedContext } from './seed-helpers.js';

// Content pools for plans (varied, realistic per-person entries)
const PLAN_CONTENT_POOLS = [
  ['Complete API endpoint implementation', 'Write unit tests for new features', 'Review and merge open PRs', 'Update project documentation'],
  ['Implement search functionality', 'Fix pagination across list views', 'Add error handling for edge cases', 'Pair programming session on schema design'],
  ['Set up monitoring and alerting', 'Migrate legacy endpoints to v2', 'Conduct code reviews for the team', 'Document deployment procedures'],
  ['Build notification system', 'Integrate with external APIs', 'Performance testing and optimization', 'Expand integration test coverage'],
  ['Refactor data access layer', 'Implement caching strategy', 'Fix accessibility audit findings', 'Update CI/CD pipeline configuration'],
  ['Design and build UI components', 'Implement responsive layouts', 'Cross-browser compatibility testing', 'Update design system tokens'],
  ['Deploy infrastructure updates', 'Configure staging environment', 'Set up auto-scaling policies', 'Review and update security configs'],
  ['Implement user settings page', 'Add form validation logic', 'Write E2E tests for critical flows', 'Optimize database queries'],
  ['Build data export feature', 'Implement audit logging', 'Fix memory leak in worker process', 'Update dependency versions'],
  ['Create admin dashboard widgets', 'Implement role-based access controls', 'Add rate limiting to API endpoints', 'Write technical design document'],
  ['Implement file upload handling', 'Build progress indicator components', 'Add WebSocket reconnection logic', 'Optimize image loading performance'],
];

// Content pools for retros (corresponding accomplishments)
const RETRO_CONTENT_POOLS = [
  ['Completed API endpoints with full CRUD operations', 'Unit tests achieving 91% coverage on new code', 'Merged 4 PRs including critical bugfix', 'API docs updated with all new endpoints'],
  ['Search feature live with fuzzy matching support', 'Pagination fixed across all list views', 'Error handling covers 12 new edge cases', 'Database schema review completed with team'],
  ['Grafana dashboards configured for all services', 'Migrated 3 legacy endpoints successfully', 'Reviewed 8 PRs from team members', 'Deployment runbook finalized and shared'],
  ['Notification system handling email and in-app alerts', 'External API integration passing all tests', 'Fixed 2 critical performance bottlenecks', 'Integration test suite grew by 15 tests'],
  ['Data layer refactored to repository pattern', 'Redis caching reducing database load by 35%', 'Fixed 6 accessibility violations (WCAG AA)', 'CI pipeline execution time reduced by 25%'],
  ['Built 10 reusable UI components for design system', 'Responsive layouts working on all breakpoints', 'Tested on Chrome, Firefox, Safari, and Edge', 'Design tokens migrated to CSS custom properties'],
  ['Infrastructure upgraded to latest AMI versions', 'Staging environment fully mirrors production', 'Auto-scaling tested successfully under load', 'Security configs reviewed and hardened'],
  ['Settings page implemented with real-time preview', 'Form validation catching all invalid inputs', 'E2E test suite covers 5 critical user flows', 'Query optimization reduced avg response time 40%'],
  ['Data export supporting CSV and JSON formats', 'Audit logging capturing all write operations', 'Memory leak identified and patched in worker', 'Dependencies updated with zero breaking changes'],
  ['Dashboard widgets showing real-time metrics', 'RBAC implemented for admin and member roles', 'Rate limiting active on all public endpoints', 'Technical design document reviewed and approved'],
  ['File upload working with drag-and-drop support', 'Progress indicators showing accurate ETAs', 'WebSocket auto-reconnect with exponential backoff', 'Image lazy-loading reducing initial bundle by 30%'],
];

function makePlanContent(items: string[]) {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'What I plan to accomplish this week' }],
      },
      {
        type: 'bulletList',
        content: items.map(item => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: item }] }],
        })),
      },
    ],
  };
}

function makeRetroContent(items: string[]) {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'What I delivered this week' }],
      },
      {
        type: 'bulletList',
        content: items.map(item => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: item }] }],
        })),
      },
    ],
  };
}

export async function seedAccountability(ctx: SeedContext): Promise<void> {
  const {
    pool,
    workspaceId,
    allUsers,
    programTeams,
    sprints,
    sprintsToCreate,
    currentSprintNumber,
  } = ctx;

  // Create weekly plans and retros for allocated people
  // This populates the Status Overview heatmap with realistic data
  let weeklyPlansCreated = 0;
  let weeklyRetrosCreated = 0;

  // Iterate through sprint assignments and create plans/retros
  for (let i = 0; i < sprintsToCreate.length; i++) {
    const sprintDef = seedAt(sprintsToCreate[i], `sprintsToCreate[${i}]`);
    const matchingSprint = sprints.find(
      s => s.programId === sprintDef.programId && s.number === sprintDef.number
    );
    if (!matchingSprint) continue;

    const owner = seedAt(allUsers[sprintDef.ownerIdx], `allUsers[${sprintDef.ownerIdx}]`);
    const team = seedAt(programTeams[sprintDef.programId], `programTeams[${sprintDef.programId}]`);
    const otherIdx = team.find(idx => idx !== sprintDef.ownerIdx) ?? seedAt(team[0], 'team[0]');
    const otherUser = seedAt(allUsers[otherIdx], `allUsers[${otherIdx}]`);
    const assignees = [
      { personDocId: owner.person_doc_id, userId: owner.id },
      { personDocId: otherUser.person_doc_id, userId: otherUser.id },
    ].filter(a => a.personDocId);

    const sprintOffset = sprintDef.number - currentSprintNumber;

    for (let p = 0; p < assignees.length; p++) {
      const assignee = seedAt(assignees[p], `assignees[${p}]`);
      const contentIdx = (i + p) % PLAN_CONTENT_POOLS.length;

      // Deterministic skip patterns for realistic gaps in past data
      // Dev User (the login user) always gets complete data so action items
      // don't conflict with the heatmap. Other users get realistic gaps.
      const isDevUser = assignee.userId === allUsers.find((u: { name: string }) => u.name === 'Dev User')?.id;
      const skipPlanForPast = !isDevUser && (i + p) % 7 === 3;     // ~14% of past plans missing
      const skipRetroForPast = !isDevUser && (i + p) % 6 === 2;    // ~17% of past retros missing
      const skipPlanForCurrent = !isDevUser && (i + p) % 3 === 0;  // ~33% of current plans not yet done

      // Past sprints: create plan + retro with content (some deliberately skipped)
      if (sprintOffset < 0) {
        if (!skipPlanForPast) {
          const existing = await pool.query<IdRow>(
        `SELECT id FROM documents
               WHERE workspace_id = $1 AND document_type = 'weekly_plan'
                 AND (properties->>'person_id') = $2
                 AND (properties->>'project_id') = $3
                 AND (properties->>'week_number')::int = $4`,
            [workspaceId, assignee.personDocId, sprintDef.projectId, sprintDef.number]
          );
          if (!existing.rows[0]) {
            await pool.query(
              `INSERT INTO documents (workspace_id, document_type, title, content, properties, visibility, created_by)
               VALUES ($1, 'weekly_plan', $2, $3, $4, 'workspace', $5)`,
              [
                workspaceId,
                `Week ${sprintDef.number} Plan`,
                JSON.stringify(makePlanContent(seedAt(PLAN_CONTENT_POOLS[contentIdx], 'planContentPools'))),
                JSON.stringify({
                  person_id: assignee.personDocId,
                  project_id: sprintDef.projectId,
                  week_number: sprintDef.number,
                  submitted_at: new Date().toISOString(),
                }),
                assignee.userId,
              ]
            );
            weeklyPlansCreated++;
          }
        }

        if (!skipRetroForPast) {
          const existing = await pool.query<IdRow>(
        `SELECT id FROM documents
               WHERE workspace_id = $1 AND document_type = 'weekly_retro'
                 AND (properties->>'person_id') = $2
                 AND (properties->>'project_id') = $3
                 AND (properties->>'week_number')::int = $4`,
            [workspaceId, assignee.personDocId, sprintDef.projectId, sprintDef.number]
          );
          if (!existing.rows[0]) {
            await pool.query(
              `INSERT INTO documents (workspace_id, document_type, title, content, properties, visibility, created_by)
               VALUES ($1, 'weekly_retro', $2, $3, $4, 'workspace', $5)`,
              [
                workspaceId,
                `Week ${sprintDef.number} Retro`,
                JSON.stringify(makeRetroContent(seedAt(RETRO_CONTENT_POOLS[contentIdx], 'retroContentPools'))),
                JSON.stringify({
                  person_id: assignee.personDocId,
                  project_id: sprintDef.projectId,
                  week_number: sprintDef.number,
                  submitted_at: new Date().toISOString(),
                }),
                assignee.userId,
              ]
            );
            weeklyRetrosCreated++;
          }
        }
      }

      // Current sprint: create plan for most people (no retros yet)
      if (sprintOffset === 0 && !skipPlanForCurrent) {
        const existing = await pool.query<IdRow>(
        `SELECT id FROM documents
             WHERE workspace_id = $1 AND document_type = 'weekly_plan'
               AND (properties->>'person_id') = $2
               AND (properties->>'project_id') = $3
               AND (properties->>'week_number')::int = $4`,
          [workspaceId, assignee.personDocId, sprintDef.projectId, sprintDef.number]
        );
        if (!existing.rows[0]) {
          await pool.query(
            `INSERT INTO documents (workspace_id, document_type, title, content, properties, visibility, created_by)
             VALUES ($1, 'weekly_plan', $2, $3, $4, 'workspace', $5)`,
            [
              workspaceId,
              `Week ${sprintDef.number} Plan`,
              JSON.stringify(makePlanContent(seedAt(PLAN_CONTENT_POOLS[contentIdx], 'planContentPools'))),
              JSON.stringify({
                person_id: assignee.personDocId,
                project_id: sprintDef.projectId,
                week_number: sprintDef.number,
                submitted_at: new Date().toISOString(),
              }),
              assignee.userId,
            ]
          );
          weeklyPlansCreated++;
        }
      }
    }
  }

  if (weeklyPlansCreated > 0) {
    console.log(`✅ Created ${weeklyPlansCreated} weekly plans`);
  }
  if (weeklyRetrosCreated > 0) {
    console.log(`✅ Created ${weeklyRetrosCreated} weekly retros`);
  }
}
