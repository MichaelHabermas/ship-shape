import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { PASSWORD_BCRYPT_ROUNDS } from '@ship/shared';
import { loadProductionSecrets } from '../config/ssm.js';
import { databaseSslOptions } from '../config/runtime.js';
import { WELCOME_DOCUMENT_TITLE, WELCOME_DOCUMENT_CONTENT } from './welcomeDocument.js';
import { IdRow, MaxTicketRow, SprintStartDateRow } from '../test/pg-result.js';
import { requireFirstRow } from '../utils/query-rows.js';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment (local dev only - production uses SSM)
config({ path: join(__dirname, '../../.env.local') });
config({ path: join(__dirname, '../../.env') });

/**
 * Helper to create document associations in the junction table
 * This replaces the legacy program_id, project_id, sprint_id columns
 */
async function createAssociation(
  pool: pg.Pool,
  documentId: string,
  relatedId: string,
  relationshipType: 'program' | 'project' | 'sprint',
  metadata?: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
    [documentId, relatedId, relationshipType, JSON.stringify(metadata || { created_via: 'seed' })]
  );
}

function makeRichIssueContent(input: {
  problem: string;
  impact: string;
  context: string;
  acceptance: string[];
  notes: string[];
}) {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Problem' }] },
      { type: 'paragraph', content: [{ type: 'text', text: input.problem }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Impact' }] },
      { type: 'paragraph', content: [{ type: 'text', text: input.impact }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Context' }] },
      { type: 'paragraph', content: [{ type: 'text', text: input.context }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Acceptance criteria' }] },
      {
        type: 'bulletList',
        content: input.acceptance.map(item => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: item }] }],
        })),
      },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Investigation notes' }] },
      {
        type: 'bulletList',
        content: input.notes.map(item => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: item }] }],
        })),
      },
    ],
  };
}

async function seed() {
  // Load secrets from SSM in production (must happen before Pool creation)
  await loadProductionSecrets();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: databaseSslOptions(),
  });
  console.log('🌱 Starting database seed...');
  // Only log hostname, never full connection string (contains credentials)
  const dbHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : 'unknown';
  console.log(`   Database host: ${dbHost}`);

  try {
    // Run schema
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    await pool.query(schema);
    console.log('✅ Schema created');

    // Check if workspace exists
    const existingWorkspace = await pool.query<IdRow>(
      'SELECT id FROM workspaces WHERE name = $1',
      ['Ship Workspace']
    );

    let workspaceId: string;

    if (existingWorkspace.rows[0]) {
      workspaceId = requireFirstRow(existingWorkspace.rows).id;
      console.log('ℹ️  Workspace already exists');
    } else {
      // Create workspace with sprint_start_date ~3 months ago, aligned to Monday.
      // Weeks must start on Monday to match production and ensure the heatmap
      // shows correct "due" (yellow) windows for plans (Sat-Mon) and retros (Thu-Fri).
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      // Roll back to the nearest Monday (day 1)
      const dayOfWeek = threeMonthsAgo.getDay(); // 0=Sun, 1=Mon, ...
      const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      threeMonthsAgo.setDate(threeMonthsAgo.getDate() - daysToSubtract);
      const workspaceResult = await pool.query<IdRow>(
        `INSERT INTO workspaces (name, sprint_start_date)
         VALUES ($1, $2)
         RETURNING id`,
        ['Ship Workspace', threeMonthsAgo.toISOString().split('T')[0]]
      );
      workspaceId = requireFirstRow(workspaceResult.rows).id;
      console.log('✅ Workspace created');
    }

    // Team members to seed (dev user + 10 fake users)
    const teamMembers = [
      { email: 'dev@ship.local', name: 'Dev User' },
      { email: 'alice.chen@ship.local', name: 'Alice Chen' },
      { email: 'bob.martinez@ship.local', name: 'Bob Martinez' },
      { email: 'carol.williams@ship.local', name: 'Carol Williams' },
      { email: 'david.kim@ship.local', name: 'David Kim' },
      { email: 'emma.johnson@ship.local', name: 'Emma Johnson' },
      { email: 'frank.garcia@ship.local', name: 'Frank Garcia' },
      { email: 'grace.lee@ship.local', name: 'Grace Lee' },
      { email: 'henry.patel@ship.local', name: 'Henry Patel' },
      { email: 'iris.nguyen@ship.local', name: 'Iris Nguyen' },
      { email: 'jack.brown@ship.local', name: 'Jack Brown' },
    ];

    const passwordHash = await bcrypt.hash('admin123', PASSWORD_BCRYPT_ROUNDS);
    let usersCreated = 0;

    for (const member of teamMembers) {
      const existingUser = await pool.query<IdRow>(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
        [member.email]
      );

      if (!existingUser.rows[0]) {
        await pool.query(
          `INSERT INTO users (email, password_hash, name, last_workspace_id)
           VALUES ($1, $2, $3, $4)`,
          [member.email, passwordHash, member.name, workspaceId]
        );
        usersCreated++;
      }
    }

    if (usersCreated > 0) {
      console.log(`✅ Created ${usersCreated} users (all use password: admin123)`);
    } else {
      console.log('ℹ️  All users already exist');
    }

    // Set dev user as super-admin and set their last workspace
    await pool.query(
      `UPDATE users SET is_super_admin = true, last_workspace_id = $1 WHERE email = 'dev@ship.local'`,
      [workspaceId]
    );
    console.log('✅ Set dev@ship.local as super-admin');

    // Create workspace memberships and Person documents for all users
    // Note: These are independent - no coupling via person_document_id
    let membershipsCreated = 0;
    let personDocsCreated = 0;
    const allUsersForMembership = await pool.query(
      'SELECT id, email, name FROM users'
    );

    for (const user of allUsersForMembership.rows) {
      // Check for existing membership
      const existingMembership = await pool.query<IdRow>(
      'SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, user.id]
      );

      if (!existingMembership.rows[0]) {
        // Make dev user an admin, others are members
        const role = user.email === 'dev@ship.local' ? 'admin' : 'member';
        await pool.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role)
           VALUES ($1, $2, $3)`,
          [workspaceId, user.id, role]
        );
        membershipsCreated++;
      }

      // Check for existing person document (via properties.user_id)
      const existingPersonDoc = await pool.query<IdRow>(
        `SELECT id FROM documents
         WHERE workspace_id = $1 AND document_type = 'person' AND properties->>'user_id' = $2`,
        [workspaceId, user.id]
      );

      if (!existingPersonDoc.rows[0]) {
        // Create Person document with properties.user_id
        await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
           VALUES ($1, 'person', $2, $3, $4)`,
          [workspaceId, user.name, JSON.stringify({ user_id: user.id, email: user.email }), user.id]
        );
        personDocsCreated++;
      }
    }

    if (membershipsCreated > 0) {
      console.log(`✅ Created ${membershipsCreated} workspace memberships`);
    } else {
      console.log('ℹ️  All workspace memberships already exist');
    }

    if (personDocsCreated > 0) {
      console.log(`✅ Created ${personDocsCreated} Person documents`);
    }

    // Set up reports_to hierarchy: Dev User → 3 managers → remaining ICs
    const reportingHierarchy: Record<string, string[]> = {
      'dev@ship.local': [], // Root — no manager
      'alice.chen@ship.local': ['dev@ship.local'],
      'bob.martinez@ship.local': ['dev@ship.local'],
      'carol.williams@ship.local': ['dev@ship.local'],
      'david.kim@ship.local': ['alice.chen@ship.local'],
      'emma.johnson@ship.local': ['alice.chen@ship.local'],
      'frank.garcia@ship.local': ['bob.martinez@ship.local'],
      'grace.lee@ship.local': ['bob.martinez@ship.local'],
      'henry.patel@ship.local': ['carol.williams@ship.local'],
      'iris.nguyen@ship.local': ['carol.williams@ship.local'],
      'jack.brown@ship.local': ['carol.williams@ship.local'],
    };

    // Build email → user_id map
    const emailToUserId = new Map<string, string>();
    for (const user of allUsersForMembership.rows) {
      emailToUserId.set(user.email, user.id);
    }

    // Set reports_to on person documents
    let reportsToSet = 0;
    for (const [email, managers] of Object.entries(reportingHierarchy)) {
      if (managers.length === 0) continue; // Root has no manager
      const managerEmail = managers[0]!;
      const managerId = emailToUserId.get(managerEmail);
      const userId = emailToUserId.get(email);
      if (managerId && userId) {
        await pool.query(
          `UPDATE documents SET properties = properties || jsonb_build_object('reports_to', $1::text)
           WHERE workspace_id = $2 AND document_type = 'person' AND properties->>'user_id' = $3`,
          [managerId, workspaceId, userId]
        );
        reportsToSet++;
      }
    }
    if (reportsToSet > 0) {
      console.log(`✅ Set reports_to for ${reportsToSet} people (3-level hierarchy)`);
    }

    // Get all user IDs for assignment (join through workspace_memberships)
    // Also get person document IDs for team allocation
    const allUsersResult = await pool.query(
      `SELECT u.id, u.name, d.id as person_doc_id FROM users u
       JOIN workspace_memberships wm ON wm.user_id = u.id
       LEFT JOIN documents d ON d.workspace_id = wm.workspace_id
         AND d.document_type = 'person' AND d.properties->>'user_id' = u.id::text
       WHERE wm.workspace_id = $1`,
      [workspaceId]
    );
    const allUsers = allUsersResult.rows;

    // Programs to seed
    const programsToSeed = [
      { prefix: 'SHIP', name: 'Ship Core', color: '#3B82F6' },
      { prefix: 'AUTH', name: 'Authentication', color: '#8B5CF6' },
      { prefix: 'API', name: 'API Platform', color: '#10B981' },
      { prefix: 'UI', name: 'Design System', color: '#F59E0B' },
      { prefix: 'INFRA', name: 'Infrastructure', color: '#EF4444' },
    ];

    const programs: Array<{ id: string; prefix: string; name: string; color: string }> = [];
    let programsCreated = 0;

    for (const prog of programsToSeed) {
      const existingProgram = await pool.query<IdRow>(
        `SELECT id FROM documents WHERE workspace_id = $1 AND document_type = $2 AND properties->>'prefix' = $3`,
        [workspaceId, 'program', prog.prefix]
      );

      if (existingProgram.rows[0]) {
        programs.push({ id: requireFirstRow(existingProgram.rows).id, ...prog });
      } else {
        const properties = { prefix: prog.prefix, color: prog.color };
        const programResult = await pool.query<IdRow>(
          `INSERT INTO documents (workspace_id, document_type, title, properties)
           VALUES ($1, 'program', $2, $3)
           RETURNING id`,
          [workspaceId, prog.name, JSON.stringify(properties)]
        );
        programs.push({ id: requireFirstRow(programResult.rows).id, ...prog });
        programsCreated++;
      }
    }

    if (programsCreated > 0) {
      console.log(`✅ Created ${programsCreated} programs`);
    } else {
      console.log('ℹ️  All programs already exist');
    }

    // Define stable teams per program so sprint ownership, issue assignment,
    // and weekly plans/retros all align consistently.
    // Uses names (not indices) because allUsers query order is non-deterministic.
    const programTeamNames: string[][] = [
      ['Dev User', 'Emma Johnson'],      // Ship Core
      ['Alice Chen', 'Frank Garcia'],    // Authentication
      ['Grace Lee', 'Henry Patel'],      // API Platform
      ['Carol Williams', 'David Kim'],   // Design System
      ['Jack Brown', 'Iris Nguyen'],     // Infrastructure
    ];
    const programTeams: Record<string, number[]> = {};
    programs.forEach((prog, idx) => {
      const names = programTeamNames[idx] || ['Dev User'];
      programTeams[prog.id] = names.map(name => {
        const userIdx = allUsers.findIndex((u: { name: string }) => u.name === name);
        return userIdx >= 0 ? userIdx : 0;
      });
    });

    // Create projects for each program
    // Each project has ICE scores (Impact, Confidence, Ease) for prioritization (1-5 scale)
    const projectTemplates = [
      {
        name: 'Core Features',
        color: '#6366f1',
        emoji: '🚀',
        impact: 5,
        confidence: 4,
        ease: 3,
        plan: 'Building core features will establish the product foundation and attract early adopters.',
        monetary_impact_expected: 50000,
        has_design_review: true,
        design_review_notes: 'Design approved after review session on 2025-01-15. UI mockups finalized.',
      },
      {
        name: 'Bug Fixes',
        color: '#ef4444',
        emoji: '🐛',
        impact: 4,
        confidence: 5,
        ease: 4,
        plan: 'Fixing bugs will improve user retention and reduce support costs.',
        monetary_impact_expected: 15000,
        has_design_review: false,
        design_review_notes: null,
      },
      {
        name: 'Performance',
        color: '#22c55e',
        emoji: '⚡',
        impact: 4,
        confidence: 3,
        ease: 2,
        plan: 'Performance improvements will increase user satisfaction and enable scale.',
        monetary_impact_expected: 25000,
        // No design review fields - will be null/undefined
      },
    ];

    const projects: Array<{ id: string; programId: string; title: string }> = [];
    let projectsCreated = 0;

    for (const program of programs) {
      for (const template of projectTemplates) {
        const projectTitle = `${program.name} - ${template.name}`;

        // Check if project already exists (via junction table association to program)
        const existingProject = await pool.query<IdRow>(
          `SELECT d.id FROM documents d
           JOIN document_associations da ON da.document_id = d.id
             AND da.related_id = $3 AND da.relationship_type = 'program'
           WHERE d.workspace_id = $1 AND d.document_type = 'project' AND d.title = $2`,
          [workspaceId, projectTitle, program.id]
        );

        if (existingProject.rows[0]) {
          projects.push({
            id: requireFirstRow(existingProject.rows).id,
            programId: program.id,
            title: projectTitle,
          });
        } else {
          // Assign owner rotating through team members
          const ownerIdx = (programs.indexOf(program) * projectTemplates.length + projectTemplates.indexOf(template)) % allUsers.length;
          const owner = allUsers[ownerIdx]!;

          // Calculate target date (2-4 weeks from now based on project type)
          const targetDate = new Date();
          targetDate.setDate(targetDate.getDate() + (projectTemplates.indexOf(template) + 2) * 7);

          const projectProperties: Record<string, unknown> = {
            color: template.color,
            emoji: template.emoji,
            owner_id: owner.id,
            // ICE scores (1-5 scale)
            impact: template.impact,
            confidence: template.confidence,
            ease: template.ease,
            plan: template.plan,
            monetary_impact_expected: template.monetary_impact_expected,
            target_date: targetDate.toISOString().split('T')[0],
          };
          // Add design review fields if present in template
          if ('has_design_review' in template) {
            projectProperties.has_design_review = template.has_design_review;
          }
          if ('design_review_notes' in template) {
            projectProperties.design_review_notes = template.design_review_notes;
          }
          // Create project document without legacy program_id column
          const projectResult = await pool.query<IdRow>(
            `INSERT INTO documents (workspace_id, document_type, title, properties)
             VALUES ($1, 'project', $2, $3)
             RETURNING id`,
            [workspaceId, projectTitle, JSON.stringify(projectProperties)]
          );
          const projectId = requireFirstRow(projectResult.rows).id;

          // Create association to program via junction table
          await createAssociation(pool, projectId, program.id, 'program');

          projects.push({
            id: projectId,
            programId: program.id,
            title: projectTitle,
          });
          projectsCreated++;
        }
      }
    }

    if (projectsCreated > 0) {
      console.log(`✅ Created ${projectsCreated} projects`);
    } else {
      console.log('ℹ️  All projects already exist');
    }

    // Get workspace sprint start date and calculate current sprint (1-week sprints)
    const wsResult = await pool.query<SprintStartDateRow>(
      'SELECT sprint_start_date FROM workspaces WHERE id = $1',
      [workspaceId]
    );
    const sprintStartDate = new Date(requireFirstRow(wsResult.rows).sprint_start_date);
    const today = new Date();
    const daysSinceStart = Math.floor((today.getTime() - sprintStartDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentSprintNumber = Math.max(1, Math.floor(daysSinceStart / 7) + 1);

    // Create sprints for each program (current-3 to current+3)
    // Sprint owners and assignees come from the program's team (not global rotation)
    // Sprints are distributed among the program's projects
    const sprintsToCreate: Array<{ programId: string; projectId: string; number: number; ownerIdx: number }> = [];
    for (const program of programs) {
      const team = programTeams[program.id]!;
      // Get projects for this program to distribute sprints among them
      const programProjects = projects.filter(p => p.programId === program.id);
      let projectIdx = 0;
      for (let sprintNum = currentSprintNumber - 3; sprintNum <= currentSprintNumber + 3; sprintNum++) {
        if (sprintNum > 0) {
          // Round-robin assign sprints to projects within the program
          const project = programProjects[projectIdx % programProjects.length]!;
          // Owner rotates within the program's team
          const ownerIdx = team[(sprintNum - 1) % team.length]!;
          sprintsToCreate.push({
            programId: program.id,
            projectId: project.id,
            number: sprintNum,
            ownerIdx,
          });
          projectIdx++;
        }
      }
    }

    const sprints: Array<{ id: string; programId: string; projectId: string; number: number }> = [];
    let sprintsCreated = 0;

    for (const sprint of sprintsToCreate) {
      const owner = allUsers[sprint.ownerIdx]!;

      // Check for existing sprint by sprint_number and project (via junction table)
      const existingSprint = await pool.query<IdRow>(
        `SELECT d.id FROM documents d
         JOIN document_associations da ON da.document_id = d.id
           AND da.related_id = $2 AND da.relationship_type = 'project'
         WHERE d.workspace_id = $1 AND d.document_type = 'sprint'
           AND (d.properties->>'sprint_number')::int = $3`,
        [workspaceId, sprint.projectId, sprint.number]
      );

      if (existingSprint.rows[0]) {
        sprints.push({
          id: requireFirstRow(existingSprint.rows).id,
          programId: sprint.programId,
          projectId: sprint.projectId,
          number: sprint.number,
        });
      } else {
        // Sprint properties with full planning details
        // Dates and status are computed at runtime from sprint_number + workspace.sprint_start_date
        // Confidence is 0-100 scale (different from project ICE scores which are 1-10)
        const sprintPlans = [
          'If we complete these features, we will unblock the next milestone.',
          'Fixing these issues will reduce user-reported problems by 50%.',
          'Performance gains will improve user engagement metrics.',
          'New features will increase user activation rate.',
          'These changes will enable the team to move faster.',
          'Better docs will reduce onboarding time for new developers.',
          'Incremental shipping will maintain momentum and user trust.',
        ];
        const sprintSuccessCriteria = [
          'All planned stories marked done, tests passing',
          'Bug count reduced by at least 10, no P0 issues remaining',
          'Load time under 2 seconds, memory usage stable',
          'Feature flags enabled for 100% of users',
          'All integrations passing health checks',
          'README and API docs up to date',
          'User feedback incorporated in next sprint planning',
        ];

        // Calculate confidence based on sprint timing (future sprints have lower confidence)
        const sprintOffset = sprint.number - currentSprintNumber;
        let baseConfidence = 80;
        if (sprintOffset < 0) baseConfidence = 95; // Past sprints - high confidence (actual results)
        else if (sprintOffset === 0) baseConfidence = 75; // Current sprint - medium-high
        else if (sprintOffset === 1) baseConfidence = 60; // Next sprint - medium
        else baseConfidence = 40; // Future sprints - lower confidence

        // Other assignee comes from the same program team (not global +1)
        const team = programTeams[sprint.programId]!;
        const otherIdx = team.find(idx => idx !== sprint.ownerIdx) ?? team[0]!;
        const otherUser = allUsers[otherIdx]!;
        // Set sprint status based on timing so action items don't fire for past sprints
        let sprintStatus: string | undefined;
        if (sprintOffset < 0) sprintStatus = 'completed';
        else if (sprintOffset === 0) sprintStatus = 'active';

        const sprintProperties: Record<string, unknown> = {
          sprint_number: sprint.number,
          owner_id: owner.id,
          project_id: sprint.projectId, // Required for team allocation
          assignee_ids: [owner.person_doc_id, otherUser.person_doc_id].filter(Boolean), // Person doc IDs for allocation
          plan: sprintPlans[sprint.number % sprintPlans.length],
          success_criteria: sprintSuccessCriteria[sprint.number % sprintSuccessCriteria.length],
          confidence: baseConfidence + (Math.random() * 10 - 5), // Add some variance
          ...(sprintStatus && { status: sprintStatus }),
        };
        // Create sprint document without legacy project_id and program_id columns
        const sprintResult = await pool.query<IdRow>(
          `INSERT INTO documents (workspace_id, document_type, title, properties)
           VALUES ($1, 'sprint', $2, $3)
           RETURNING id`,
          [workspaceId, `Week ${sprint.number}`, JSON.stringify(sprintProperties)]
        );
        const sprintId = requireFirstRow(sprintResult.rows).id;

        // Create associations via junction table (sprint belongs to project AND program)
        await createAssociation(pool, sprintId, sprint.projectId, 'project');
        await createAssociation(pool, sprintId, sprint.programId, 'program');

        sprints.push({
          id: sprintId,
          programId: sprint.programId,
          projectId: sprint.projectId,
          number: sprint.number,
        });
        sprintsCreated++;
      }
    }

    if (sprintsCreated > 0) {
      console.log(`✅ Created ${sprintsCreated} weeks`);
    } else {
      console.log('ℹ️  All weeks already exist');
    }

    // Get Ship Core program for comprehensive sprint testing
    const shipCoreProgram = programs.find(p => p.prefix === 'SHIP')!;

    // Comprehensive issue templates for Ship Core covering all sprint/state combinations
    // This gives us realistic data to test all views
    // estimate added for sprint planning features (progress graph, accountability)
    const shipCoreIssues = [
      // Sprint -3 (completed, older history): All done
      { title: 'Initial project setup', state: 'done', sprintOffset: -3, priority: 'high', estimate: 8 },
      { title: 'Database schema design', state: 'done', sprintOffset: -3, priority: 'high', estimate: 6 },
      { title: 'Set up development environment', state: 'done', sprintOffset: -3, priority: 'medium', estimate: 4 },
      { title: 'Create basic API structure', state: 'done', sprintOffset: -3, priority: 'medium', estimate: 4 },

      // Sprint -2 (completed): Mostly done, some incomplete (tests pattern alert)
      { title: 'Implement user authentication', state: 'done', sprintOffset: -2, priority: 'high', estimate: 8 },
      { title: 'Add password hashing', state: 'done', sprintOffset: -2, priority: 'high', estimate: 4 },
      { title: 'Create session management', state: 'todo', sprintOffset: -2, priority: 'medium', estimate: 6 },
      { title: 'Build login/logout endpoints', state: 'done', sprintOffset: -2, priority: 'medium', estimate: 4 },
      { title: 'Add CSRF protection', state: 'todo', sprintOffset: -2, priority: 'medium', estimate: 4 },
      { title: 'Write auth unit tests', state: 'todo', sprintOffset: -2, priority: 'low', estimate: 3 },

      // Sprint -1 (completed): Low completion (tests pattern alert - 2 consecutive)
      { title: 'Create document model', state: 'done', sprintOffset: -1, priority: 'high', estimate: 8 },
      { title: 'Implement CRUD operations', state: 'todo', sprintOffset: -1, priority: 'high', estimate: 6 },
      { title: 'Add real-time collaboration', state: 'todo', sprintOffset: -1, priority: 'high', estimate: 8 },
      { title: 'Build WebSocket server', state: 'done', sprintOffset: -1, priority: 'medium', estimate: 6 },
      { title: 'Integrate Yjs for CRDT', state: 'todo', sprintOffset: -1, priority: 'medium', estimate: 6 },
      { title: 'Add offline support', state: 'cancelled', sprintOffset: -1, priority: 'low', estimate: 4 },

      // Current sprint: Mix of done, in_progress, todo
      { title: 'Implement sprint management', state: 'done', sprintOffset: 0, priority: 'high', estimate: 8 },
      { title: 'Create sprint timeline UI', state: 'done', sprintOffset: 0, priority: 'high', estimate: 6 },
      { title: 'Add sprint progress chart', state: 'done', sprintOffset: 0, priority: 'medium', estimate: 4 },
      { title: 'Build issue assignment flow', state: 'in_progress', sprintOffset: 0, priority: 'high', estimate: 6 },
      { title: 'Add bulk issue operations', state: 'in_progress', sprintOffset: 0, priority: 'medium', estimate: 4 },
      { title: 'Create sprint retrospective view', state: 'in_progress', sprintOffset: 0, priority: 'medium', estimate: 4 },
      { title: 'Add sprint velocity metrics', state: 'todo', sprintOffset: 0, priority: 'medium', estimate: 4 },
      { title: 'Implement burndown chart', state: 'todo', sprintOffset: 0, priority: 'medium', estimate: 6 },
      { title: 'Add sprint completion notifications', state: 'todo', sprintOffset: 0, priority: 'low', estimate: 2 },

      // Sprint +1 (upcoming): Some planned todo items
      { title: 'Add team workload view', state: 'todo', sprintOffset: 1, priority: 'high', estimate: 8 },
      { title: 'Create capacity planning', state: 'todo', sprintOffset: 1, priority: 'high', estimate: 6 },
      { title: 'Build resource allocation UI', state: 'todo', sprintOffset: 1, priority: 'medium', estimate: 4 },
      { title: 'Add team availability calendar', state: 'backlog', sprintOffset: 1, priority: 'low', estimate: 3 },

      // Sprint +2 (upcoming): Fewer planned items
      { title: 'Implement reporting dashboard', state: 'todo', sprintOffset: 2, priority: 'medium', estimate: 6 },
      { title: 'Add export to PDF', state: 'backlog', sprintOffset: 2, priority: 'low', estimate: 4 },

      // Sprint +3 (upcoming): Empty - no issues assigned

      // Backlog (no sprint): Ideas for future
      { title: 'Add dark mode support', state: 'backlog', sprintOffset: null, priority: 'low', estimate: 4 },
      { title: 'Implement keyboard shortcuts', state: 'backlog', sprintOffset: null, priority: 'low', estimate: 3 },
      { title: 'Create mobile app', state: 'backlog', sprintOffset: null, priority: 'low', estimate: 40 },
      { title: 'Add AI-powered suggestions', state: 'backlog', sprintOffset: null, priority: 'low', estimate: 16 },
      { title: 'Build integration with Slack', state: 'backlog', sprintOffset: null, priority: 'medium', estimate: 8 },
    ];

    // Generic issues for other programs - expanded for better testing
    const genericIssueTemplates = [
      // Completed issues (past sprints)
      { title: 'Set up project structure', state: 'done', estimate: 4, sprintOffset: -2, priority: 'high' },
      { title: 'Create initial documentation', state: 'done', estimate: 3, sprintOffset: -2, priority: 'medium' },
      { title: 'Define coding standards', state: 'done', estimate: 2, sprintOffset: -2, priority: 'low' },
      { title: 'Configure CI/CD pipeline', state: 'done', estimate: 6, sprintOffset: -1, priority: 'high' },
      { title: 'Set up staging environment', state: 'done', estimate: 4, sprintOffset: -1, priority: 'medium' },
      // Current sprint - mix of states
      { title: 'Implement core features', state: 'done', estimate: 8, sprintOffset: 0, priority: 'high' },
      { title: 'Add input validation', state: 'done', estimate: 4, sprintOffset: 0, priority: 'high' },
      { title: 'Create error handling', state: 'in_progress', estimate: 5, sprintOffset: 0, priority: 'high' },
      { title: 'Build user interface', state: 'in_progress', estimate: 6, sprintOffset: 0, priority: 'medium' },
      { title: 'Add unit tests', state: 'todo', estimate: 4, sprintOffset: 0, priority: 'medium' },
      { title: 'Write integration tests', state: 'todo', estimate: 5, sprintOffset: 0, priority: 'low' },
      // Upcoming sprint
      { title: 'Performance optimization', state: 'todo', estimate: 6, sprintOffset: 1, priority: 'medium' },
      { title: 'Add caching layer', state: 'todo', estimate: 4, sprintOffset: 1, priority: 'medium' },
      { title: 'Security audit fixes', state: 'todo', estimate: 8, sprintOffset: 1, priority: 'high' },
      // Backlog
      { title: 'Implement analytics', state: 'backlog', estimate: 6, sprintOffset: null, priority: 'low' },
      { title: 'Add export functionality', state: 'backlog', estimate: 4, sprintOffset: null, priority: 'low' },
      { title: 'Create admin dashboard', state: 'backlog', estimate: 10, sprintOffset: null, priority: 'medium' },
    ];

    let issuesCreated = 0;

    // Get existing max ticket numbers per program (via junction table)
    const maxTickets: Record<string, number> = {};
    for (const program of programs) {
      const maxResult = await pool.query<MaxTicketRow>(
        `SELECT COALESCE(MAX(d.ticket_number), 0) as max_ticket
         FROM documents d
         JOIN document_associations da ON da.document_id = d.id
           AND da.related_id = $2 AND da.relationship_type = 'program'
         WHERE d.workspace_id = $1 AND d.document_type = 'issue'`,
        [workspaceId, program.id]
      );
      maxTickets[program.id] = requireFirstRow(maxResult.rows).max_ticket ?? 0;
    }

    // Seed Ship Core issues with comprehensive sprint coverage
    const shipCoreTeam = programTeams[shipCoreProgram.id]!;
    for (let i = 0; i < shipCoreIssues.length; i++) {
      const issue = shipCoreIssues[i]!;
      const assignee = allUsers[shipCoreTeam[i % shipCoreTeam.length]!]!;

      // Find the sprint based on offset
      let sprintId: string | null = null;
      if (issue.sprintOffset !== null) {
        const targetSprintNumber = currentSprintNumber + issue.sprintOffset;
        const sprint = sprints.find(
          s => s.programId === shipCoreProgram.id && s.number === targetSprintNumber
        );
        sprintId = sprint?.id || null;
      }

      // Check if issue already exists (via junction table association to program)
      const existingIssue = await pool.query<IdRow>(
        `SELECT d.id FROM documents d
         JOIN document_associations da ON da.document_id = d.id
           AND da.related_id = $2 AND da.relationship_type = 'program'
         WHERE d.workspace_id = $1 AND d.title = $3 AND d.document_type = 'issue'`,
        [workspaceId, shipCoreProgram.id, issue.title]
      );

      if (!existingIssue.rows[0]) {
        maxTickets[shipCoreProgram.id]!++;
        const issueProperties: Record<string, unknown> = {
          state: issue.state,
          priority: issue.priority,
          source: 'internal',
          assignee_id: assignee.id,
          feedback_status: null,
          rejection_reason: null,
        };
        // Add estimate if provided
        if (issue.estimate !== null) {
          issueProperties.estimate = issue.estimate;
        }
        // Create issue document without legacy program_id and sprint_id columns
        const issueResult = await pool.query<IdRow>(
          `INSERT INTO documents (workspace_id, document_type, title, properties, ticket_number)
           VALUES ($1, 'issue', $2, $3, $4)
           RETURNING id`,
          [workspaceId, issue.title, JSON.stringify(issueProperties), maxTickets[shipCoreProgram.id]]
        );
        const issueId = requireFirstRow(issueResult.rows).id;

        // Create associations via junction table
        await createAssociation(pool, issueId, shipCoreProgram.id, 'program');
        if (sprintId) {
          await createAssociation(pool, issueId, sprintId, 'sprint');
          // Also associate with the project that the sprint belongs to
          const sprintData = sprints.find(s => s.id === sprintId);
          if (sprintData?.projectId) {
            await createAssociation(pool, issueId, sprintData.projectId, 'project');
          }
        } else {
          // For backlog issues without sprints, assign to a random project in the program
          const programProjects = projects.filter(p => p.programId === shipCoreProgram.id);
          if (programProjects.length > 0) {
            const randomProject = programProjects[issuesCreated % programProjects.length]!;
            await createAssociation(pool, issueId, randomProject.id, 'project');
          }
        }

        issuesCreated++;
      }
    }

    // Seed generic issues for other programs
    const otherPrograms = programs.filter(p => p.prefix !== 'SHIP');
    for (const program of otherPrograms) {
      const team = programTeams[program.id]!;
      for (let i = 0; i < genericIssueTemplates.length; i++) {
        const template = genericIssueTemplates[i]!;
        const assignee = allUsers[team[i % team.length]!]!;

        // Find the sprint based on offset (same pattern as Ship Core issues)
        let sprintId: string | null = null;
        if (template.sprintOffset !== null) {
          const targetSprintNumber = currentSprintNumber + template.sprintOffset;
          const sprint = sprints.find(
            s => s.programId === program.id && s.number === targetSprintNumber
          );
          sprintId = sprint?.id || null;
        }

        // Check if issue already exists (via junction table association to program)
        const existingIssue = await pool.query<IdRow>(
          `SELECT d.id FROM documents d
           JOIN document_associations da ON da.document_id = d.id
             AND da.related_id = $2 AND da.relationship_type = 'program'
           WHERE d.workspace_id = $1 AND d.title = $3 AND d.document_type = 'issue'`,
          [workspaceId, program.id, template.title]
        );

        if (!existingIssue.rows[0]) {
          maxTickets[program.id]!++;
          const issueProperties = {
            state: template.state,
            priority: template.priority,
            source: 'internal',
            assignee_id: assignee.id,
            feedback_status: null,
            rejection_reason: null,
            estimate: template.estimate,
          };
          // Create issue document without legacy program_id and sprint_id columns
          const issueResult = await pool.query<IdRow>(
            `INSERT INTO documents (workspace_id, document_type, title, properties, ticket_number)
             VALUES ($1, 'issue', $2, $3, $4)
             RETURNING id`,
            [workspaceId, template.title, JSON.stringify(issueProperties), maxTickets[program.id]]
          );
          const issueId = requireFirstRow(issueResult.rows).id;

          // Create associations via junction table
          await createAssociation(pool, issueId, program.id, 'program');
          if (sprintId) {
            await createAssociation(pool, issueId, sprintId, 'sprint');
            // Also associate with the project that the sprint belongs to
            const sprintData = sprints.find(s => s.id === sprintId);
            if (sprintData?.projectId) {
              await createAssociation(pool, issueId, sprintData.projectId, 'project');
            }
          } else {
            // For backlog issues without sprints, assign to a random project in the program
            const programProjects = projects.filter(p => p.programId === program.id);
            if (programProjects.length > 0) {
              const randomProject = programProjects[issuesCreated % programProjects.length]!;
              await createAssociation(pool, issueId, randomProject.id, 'project');
            }
          }

          issuesCreated++;
        }
      }
    }

    if (issuesCreated > 0) {
      console.log(`✅ Created ${issuesCreated} issues`);
    } else {
      console.log('ℹ️  All issues already exist');
    }

    const fleetGraphSignalTemplates = [
      {
        signalType: 'blocked',
        state: 'blocked',
        prefix: 'FG-BLOCKED',
        summaries: [
          ['SSO callback contract blocked by identity provider review', 'Waiting on the identity team to confirm the callback payload and signing key rotation window before the API contract can be finalized.'],
          ['Payment reconciliation blocked by missing treasury sample file', 'The importer cannot be validated until Finance provides the May close sample with reversal, partial payment, and duplicate invoice cases.'],
          ['Notification digest blocked on email domain approval', 'The digest job is ready for staging, but SES domain verification is still pending with platform operations.'],
          ['Role migration blocked by production permission export', 'The migration plan needs the current role export so we can prove no workspace admins lose access during cutover.'],
          ['Mobile upload flow blocked by antivirus vendor response', 'The attachment scanner is rejecting signed iOS uploads and the vendor has not confirmed the expected MIME override.'],
          ['Data retention job blocked by legal hold matrix', 'The delete worker cannot ship until Legal marks which document classes are exempt from the 90-day retention window.'],
          ['Bulk move blocked by week ownership ambiguity', 'Moving issues between weeks needs a decision on whether owner reassignment follows the issue or stays with the source week.'],
          ['Reviewer console blocked by CSP exception approval', 'The embedded evidence viewer needs one approved frame-src exception before it can render reviewer artifacts.'],
          ['Audit export blocked by column classification', 'Security has not classified two export columns, so the CSV generator cannot decide whether masking is required.'],
          ['Workspace invite flow blocked by SMTP bounce analysis', 'Invites to agency domains are bouncing and mail operations has not returned the DMARC alignment report.'],
        ],
      },
      {
        signalType: 'stale',
        state: 'in_progress',
        prefix: 'FG-STALE',
        summaries: [
          ['Search relevance tuning has not moved since kickoff', 'No implementation update has landed for 34 days despite the issue being assigned to the current week.'],
          ['Project health rollup stalled after initial schema notes', 'The issue has old design notes but no code, comments, or status movement since the first estimate.'],
          ['Attachment preview accessibility follow-up is idle', 'The accessibility finding remains open and the last update predates the most recent review cycle.'],
          ['API pagination cleanup stopped after route inventory', 'The route inventory was captured, but no endpoint has been converted or marked out of scope.'],
          ['Week dashboard empty-state copy is aging out', 'The issue is still in progress while the copy decision has been unchanged for more than three weeks.'],
          ['Document conversion audit has no recent evidence', 'The conversion checklist has not been updated since the first test pass and risk is accumulating.'],
          ['Resource allocation export has gone quiet', 'The issue has an owner and estimate, but there are no recent commits or standup references.'],
          ['Keyboard navigation polish is still open after review', 'The review was completed, but the follow-up issue has not changed state since the notes were attached.'],
          ['Program breadcrumb cleanup has stale design assumptions', 'The issue references an old navigation model and needs refresh before implementation continues.'],
          ['Bulk selection affordance has no current owner signal', 'The issue remains assigned, but no one has updated scope, blockers, or next action in 29 days.'],
        ],
      },
      {
        signalType: 'at_risk',
        state: 'todo',
        prefix: 'FG-RISK',
        summaries: [
          ['Security evidence bundle at risk for reviewer deadline', 'The issue is due in two days and still lacks the automated evidence links reviewers expect.'],
          ['Week close reconciliation at risk due to unresolved children', 'Several child issues remain incomplete and the week close path will surface noisy warnings.'],
          ['Invite acceptance flow at risk from cross-browser gap', 'Safari coverage is missing for the redirect path used by external collaborators.'],
          ['Audit log viewer at risk from large workspace load', 'The query is still unpaged and the test workspace now has enough data to trigger slow responses.'],
          ['Program status badge at risk from mixed source states', 'The rollup combines stale, blocked, and cancelled issues without a deterministic precedence rule.'],
          ['Export redaction at risk before compliance demo', 'The demo depends on redacted exports, but masking rules are still represented as notes only.'],
          ['FleetGraph explain action at risk from missing draft path', 'Notifications can open a discussion, but the recommended draft path is not validated end to end.'],
          ['My Week accountability at risk from skipped plan coverage', 'Some assignees have active week work and no plan document, which will confuse the heatmap.'],
          ['Project retro summary at risk from incomplete impact data', 'The retro generator has expected impact but no actual impact or next-step data on several projects.'],
          ['Realtime document handoff at risk from reconnect edge case', 'The collaboration state recovers after refresh but not after a network drop during editing.'],
        ],
      },
    ] as const;

    let attentionIssuesCreated = 0;
    let fleetGraphFindingsCreated = 0;
    const currentSprints = sprints.filter(s => s.number === currentSprintNumber);

    for (const [groupIndex, group] of fleetGraphSignalTemplates.entries()) {
      for (let i = 0; i < group.summaries.length; i++) {
        const [title, summary] = group.summaries[i]!;
        const program = programs[(i + groupIndex) % programs.length]!;
        const programProjects = projects.filter(p => p.programId === program.id);
        const project = programProjects[i % programProjects.length]!;
        const sprint = currentSprints.find(s => s.programId === program.id) ?? sprints.find(s => s.programId === program.id)!;
        const team = programTeams[program.id]!;
        const assignee = allUsers[team[i % team.length]!]!;
        const daysAgo = 5 + groupIndex * 11 + i * 3;
        const detectedHoursAgo = 2 + groupIndex * 4 + i * 5;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + (group.signalType === 'at_risk' ? (i % 4) + 1 : 7 + i));
        const titleWithPrefix = `${group.prefix}-${String(i + 1).padStart(2, '0')} ${title}`;

        const existingIssue = await pool.query<IdRow>(
          `SELECT d.id FROM documents d
           JOIN document_associations da ON da.document_id = d.id
             AND da.related_id = $2 AND da.relationship_type = 'program'
           WHERE d.workspace_id = $1 AND d.document_type = 'issue' AND d.title = $3`,
          [workspaceId, program.id, titleWithPrefix]
        );

        let issueId = existingIssue.rows[0]?.id;
        if (!issueId) {
          maxTickets[program.id]!++;
          const blockerText = group.signalType === 'blocked' ? summary : null;
          const content = makeRichIssueContent({
            problem: summary,
            impact: group.signalType === 'blocked'
              ? 'Delivery is stopped until the external dependency is resolved; downstream work should not be scheduled against this issue.'
              : group.signalType === 'stale'
                ? 'The issue is still assigned and visible in current planning, but the lack of movement makes progress reporting unreliable.'
                : 'The issue can still land, but the deadline, dependency, or quality bar is tight enough that it needs active management now.',
            context: `Seeded FleetGraph ${group.signalType} scenario for ${program.name}. The dates, owners, and reasons are intentionally varied so notification sorting, filtering, and discussion flows have realistic data.`,
            acceptance: [
              'Owner has a concrete next action with a named dependency or decision maker.',
              'Issue status, priority, and due date reflect the current risk.',
              'FleetGraph notification explains why this item needs attention without exposing hidden data.',
            ],
            notes: [
              `Assignee: ${assignee.name}.`,
              `Age: ${daysAgo} days since the last meaningful issue update.`,
              `Reason: ${summary}`,
            ],
          });
          const properties = {
            state: group.state,
            priority: i % 3 === 0 ? 'urgent' : i % 3 === 1 ? 'high' : 'medium',
            source: 'internal',
            assignee_id: assignee.id,
            estimate: 3 + (i % 6),
            due_date: dueDate.toISOString().split('T')[0],
            feedback_status: null,
            rejection_reason: null,
            blocker_text: blockerText,
            blocked_reason: blockerText,
            attention_seed: group.signalType,
          };
          const issueResult = await pool.query<IdRow>(
            `INSERT INTO documents (
               workspace_id, document_type, title, content, properties, ticket_number, created_by, created_at, updated_at
             )
             VALUES ($1, 'issue', $2, $3, $4, $5, $6, NOW() - ($7::int * INTERVAL '1 day'), NOW() - ($7::int * INTERVAL '1 day'))
             RETURNING id`,
            [
              workspaceId,
              titleWithPrefix,
              JSON.stringify(content),
              JSON.stringify(properties),
              maxTickets[program.id],
              assignee.id,
              daysAgo,
            ]
          );
          issueId = requireFirstRow(issueResult.rows).id;
          await createAssociation(pool, issueId, program.id, 'program');
          await createAssociation(pool, issueId, project.id, 'project');
          await createAssociation(pool, issueId, sprint.id, 'sprint');
          attentionIssuesCreated++;
        }

        const dedupeKey = `${group.signalType === 'at_risk' ? 'at-risk' : group.signalType}-issue:${workspaceId}:${issueId}:${sprint.id}`;
        const existingFinding = await pool.query<IdRow>(
          `SELECT id FROM fleetgraph_findings
           WHERE workspace_id = $1 AND dedupe_key = $2 AND status IN ('open', 'needs_confirmation', 'error')`,
          [workspaceId, dedupeKey]
        );

        if (!existingFinding.rows[0]) {
          const evidence = [
            {
              kind: 'source_issue',
              sourceDocumentId: issueId,
              sourceType: 'issue',
              claim: `Issue ${titleWithPrefix}`,
              visibility: 'internal',
              visibleFields: ['title', 'ticket_number', 'priority', 'state'],
            },
            {
              kind: 'source_sprint',
              sourceDocumentId: sprint.id,
              sourceType: 'sprint',
              claim: `Week ${sprint.number}`,
              visibility: 'internal',
              visibleFields: ['title', 'sprint_number'],
            },
            {
              kind: group.signalType === 'blocked' ? 'blocker' : group.signalType,
              sourceDocumentId: issueId,
              sourceType: 'issue',
              claim: group.signalType === 'blocked' ? 'Current blocker' : summary,
              excerpt: summary,
              visibility: 'internal',
              visibleFields: ['state', 'priority', 'updated_at', 'due_date'],
            },
          ];
          await pool.query(
            `INSERT INTO fleetgraph_findings (
               workspace_id, source_issue_id, source_sprint_id, dedupe_key,
               status, severity, confidence, title, summary, evidence_snapshot,
               recommended_action, draft_content, proposed_recipient, human_gate,
               trace_metadata, run_metadata, first_detected_at, last_detected_at, created_at, updated_at
             )
             VALUES (
               $1, $2, $3, $4, 'open', $5, $6, $7, $8, $9,
               $10, $11, $12, $13, $14, $15,
               NOW() - ($16::int * INTERVAL '1 hour'),
               NOW() - ($16::int * INTERVAL '1 hour'),
               NOW() - ($16::int * INTERVAL '1 hour'),
               NOW() - ($16::int * INTERVAL '1 hour')
             )`,
            [
              workspaceId,
              issueId,
              sprint.id,
              dedupeKey,
              group.signalType === 'at_risk' || i % 3 === 0 ? 'high' : 'medium',
              0.82 + (i % 4) * 0.035,
              title,
              summary,
              JSON.stringify(evidence),
              JSON.stringify({
                label: group.signalType === 'blocked' ? 'Unblock issue' : group.signalType === 'stale' ? 'Refresh plan' : 'Reduce risk',
                summary: 'Open the issue, confirm the owner, and record the next dated action.',
              }),
              JSON.stringify({
                subject: title,
                body: `Can you update ${titleWithPrefix}? FleetGraph flagged it because: ${summary}`,
              }),
              JSON.stringify({
                role: 'issue_assignee',
                userId: assignee.id,
                displayName: assignee.name,
                rationale: 'Seeded scenario routes the notification to the issue assignee.',
              }),
              JSON.stringify({ required: false, reason: 'seed_demo_data' }),
              JSON.stringify({ mode: 'proactive', decision: 'create_finding', seed: true }),
              JSON.stringify({
                signalType: group.signalType,
                reason: summary,
                uncertaintyNotes: [
                  'Seed data intentionally varies age, owner, severity, and due date.',
                  'Confirm the issue document before taking action.',
                ],
              }),
              detectedHoursAgo,
            ]
          );
          fleetGraphFindingsCreated++;
        }
      }
    }

    if (attentionIssuesCreated > 0) {
      console.log(`✅ Created ${attentionIssuesCreated} FleetGraph attention issues`);
    } else {
      console.log('ℹ️  All FleetGraph attention issues already exist');
    }
    if (fleetGraphFindingsCreated > 0) {
      console.log(`✅ Created ${fleetGraphFindingsCreated} FleetGraph notification findings`);
    } else {
      console.log('ℹ️  All FleetGraph notification findings already exist');
    }

    type SeedSignalType = 'blocked' | 'stale' | 'at_risk';
    const multiSignalIssues: Array<{ signals: SeedSignalType[]; title: string; reasons: string[] }> = [
      { signals: ['blocked', 'stale'], title: 'Agency SSO redirect has stalled behind certificate approval', reasons: ['Certificate approval is blocking redirect validation.', 'The redirect issue has had no meaningful update for 31 days.'] },
      { signals: ['blocked', 'stale'], title: 'Reviewer evidence import waits on sample archive', reasons: ['The reviewer sample archive has not been delivered.', 'The import plan has not changed since the first spike.'] },
      { signals: ['blocked', 'stale'], title: 'Legacy role cleanup depends on inactive owner response', reasons: ['The role owner has not approved the cleanup list.', 'The issue remains assigned with no current next action.'] },
      { signals: ['blocked', 'stale'], title: 'Notification delivery audit is waiting on bounce logs', reasons: ['Mail operations has not provided bounce logs.', 'The audit has been idle across multiple standups.'] },
      { signals: ['blocked', 'stale'], title: 'Document archive validation is held by policy exception', reasons: ['Records policy has not approved the exception path.', 'The validation notes are older than the current retention plan.'] },
      { signals: ['blocked', 'at_risk'], title: 'Compliance export masking is blocked near demo', reasons: ['Data classification is missing for two export fields.', 'The compliance demo is inside the current delivery window.'] },
      { signals: ['blocked', 'at_risk'], title: 'Workspace invite recovery is blocked before pilot', reasons: ['SMTP alignment remains unresolved for pilot domains.', 'Pilot onboarding depends on this path this week.'] },
      { signals: ['blocked', 'at_risk'], title: 'Audit viewer pagination is blocked by query ownership', reasons: ['The API owner has not signed off on the pagination contract.', 'Large workspaces can time out during reviewer walkthroughs.'] },
      { signals: ['blocked', 'at_risk'], title: 'Week close warnings blocked by parent-child policy', reasons: ['The team has not decided whether blocked children prevent close.', 'Week close is scheduled before the decision meeting.'] },
      { signals: ['blocked', 'at_risk'], title: 'File preview hardening blocked by scanner vendor', reasons: ['The scanner vendor has not confirmed the false positive rule.', 'Attachment preview is committed for the next security review.'] },
      { signals: ['stale', 'at_risk'], title: 'Program health rollup has old precedence assumptions', reasons: ['The rollup logic has not been refreshed after FleetGraph labels shipped.', 'Mixed-status programs may show the wrong executive summary.'] },
      { signals: ['stale', 'at_risk'], title: 'My Week plan gaps are aging into accountability noise', reasons: ['The missing-plan cases have not been revisited since last week.', 'Managers will see noisy action items during planning.'] },
      { signals: ['stale', 'at_risk'], title: 'Bulk selection keyboard affordance missed review follow-up', reasons: ['The keyboard review notes are still unresolved.', 'The selection flow is on the accessibility demo path.'] },
      { signals: ['stale', 'at_risk'], title: 'Project retro impact tracking lacks current evidence', reasons: ['Actual impact fields have not been updated after release.', 'Retro summaries will understate outcomes for current projects.'] },
      { signals: ['stale', 'at_risk'], title: 'Realtime reconnect testing is behind release branch', reasons: ['Reconnect edge cases have no recent test evidence.', 'The branch is approaching release without collaboration confidence.'] },
      { signals: ['blocked', 'stale', 'at_risk'], title: 'Security console deploy readiness is blocked and aging', reasons: ['AWS environment approval is still pending.', 'The deployment checklist has not moved in 28 days.', 'Reviewer access depends on this before the next evidence package.'] },
      { signals: ['blocked', 'stale', 'at_risk'], title: 'External feedback triage migration needs owner decision', reasons: ['Product has not approved the migration mapping.', 'The migration issue has stale acceptance criteria.', 'Untriaged feedback will leak into the pilot dashboard.'] },
      { signals: ['blocked', 'stale', 'at_risk'], title: 'Document permission audit cannot close without matrix update', reasons: ['The auth matrix update is blocking closure.', 'The issue has not been refreshed after the latest route changes.', 'Permission regressions would affect reviewer-visible documents.'] },
      { signals: ['blocked', 'stale', 'at_risk'], title: 'FleetGraph draft action path lacks final review', reasons: ['The generated draft copy needs legal review.', 'The review request has been idle since the first notification spike.', 'Users may discuss notifications without a safe next-action draft.'] },
      { signals: ['blocked', 'stale', 'at_risk'], title: 'Cross-workspace seed verification is waiting on target URLs', reasons: ['The deployed database target list has not been confirmed.', 'The rollout instructions have not changed since local-only seeding.', 'Demo parity across local, test, and deployed environments is at risk.'] },
    ];

    let multiSignalIssuesCreated = 0;
    let multiSignalFindingsCreated = 0;

    for (let i = 0; i < multiSignalIssues.length; i++) {
      const scenario = multiSignalIssues[i]!;
      const program = programs[i % programs.length]!;
      const programProjects = projects.filter(p => p.programId === program.id);
      const project = programProjects[(i + 1) % programProjects.length]!;
      const sprint = currentSprints.find(s => s.programId === program.id) ?? sprints.find(s => s.programId === program.id)!;
      const team = programTeams[program.id]!;
      const assignee = allUsers[team[(i + 1) % team.length]!]!;
      const daysAgo = 19 + i * 2;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (i % 5) + 1);
      const titleWithPrefix = `FG-MULTI-${String(i + 1).padStart(2, '0')} ${scenario.title}`;

      const existingIssue = await pool.query<IdRow>(
        `SELECT d.id FROM documents d
         JOIN document_associations da ON da.document_id = d.id
           AND da.related_id = $2 AND da.relationship_type = 'program'
         WHERE d.workspace_id = $1 AND d.document_type = 'issue' AND d.title = $3`,
        [workspaceId, program.id, titleWithPrefix]
      );

      let issueId = existingIssue.rows[0]?.id;
      if (!issueId) {
        maxTickets[program.id]!++;
        const content = makeRichIssueContent({
          problem: scenario.reasons.join(' '),
          impact: 'This issue intentionally carries multiple attention signals so notification handling, source navigation, and discussion context can be tested against overlapping risk.',
          context: `Seeded multi-signal FleetGraph scenario for ${program.name}. Signals: ${scenario.signals.join(', ')}.`,
          acceptance: [
            'Every signal appears as its own notification tied to the same source issue.',
            'Opening any notification lands on the same fully written issue document.',
            'The owner can distinguish blocker, stale, and risk reasons without losing context.',
          ],
          notes: [
            `Assignee: ${assignee.name}.`,
            `Age: ${daysAgo} days since last meaningful update.`,
            `Signals: ${scenario.signals.join(', ')}.`,
            ...scenario.reasons,
          ],
        });
        const properties = {
          state: scenario.signals.includes('blocked') ? 'blocked' : 'in_progress',
          priority: scenario.signals.includes('at_risk') ? 'urgent' : 'high',
          source: 'internal',
          assignee_id: assignee.id,
          estimate: 5 + (i % 8),
          due_date: dueDate.toISOString().split('T')[0],
          feedback_status: null,
          rejection_reason: null,
          blocker_text: scenario.signals.includes('blocked') ? scenario.reasons[0] : null,
          blocked_reason: scenario.signals.includes('blocked') ? scenario.reasons[0] : null,
          attention_seed: 'multi_signal',
          attention_signals: scenario.signals,
        };
        const issueResult = await pool.query<IdRow>(
          `INSERT INTO documents (
             workspace_id, document_type, title, content, properties, ticket_number, created_by, created_at, updated_at
           )
           VALUES ($1, 'issue', $2, $3, $4, $5, $6, NOW() - ($7::int * INTERVAL '1 day'), NOW() - ($7::int * INTERVAL '1 day'))
           RETURNING id`,
          [
            workspaceId,
            titleWithPrefix,
            JSON.stringify(content),
            JSON.stringify(properties),
            maxTickets[program.id],
            assignee.id,
            daysAgo,
          ]
        );
        issueId = requireFirstRow(issueResult.rows).id;
        await createAssociation(pool, issueId, program.id, 'program');
        await createAssociation(pool, issueId, project.id, 'project');
        await createAssociation(pool, issueId, sprint.id, 'sprint');
        multiSignalIssuesCreated++;
      }

      for (let signalIndex = 0; signalIndex < scenario.signals.length; signalIndex++) {
        const signalType = scenario.signals[signalIndex]!;
        const reason = scenario.reasons[signalIndex] ?? scenario.reasons[0]!;
        const dedupeSignal = signalType === 'at_risk' ? 'at-risk' : signalType;
        const dedupeKey = `${dedupeSignal}-issue:${workspaceId}:${issueId}:${sprint.id}:multi-${signalIndex}`;
        const existingFinding = await pool.query<IdRow>(
          `SELECT id FROM fleetgraph_findings
           WHERE workspace_id = $1 AND dedupe_key = $2 AND status IN ('open', 'needs_confirmation', 'error')`,
          [workspaceId, dedupeKey]
        );

        if (!existingFinding.rows[0]) {
          const evidence = [
            {
              kind: 'source_issue',
              sourceDocumentId: issueId,
              sourceType: 'issue',
              claim: `Issue ${titleWithPrefix}`,
              visibility: 'internal',
              visibleFields: ['title', 'ticket_number', 'priority', 'state'],
            },
            {
              kind: 'source_sprint',
              sourceDocumentId: sprint.id,
              sourceType: 'sprint',
              claim: `Week ${sprint.number}`,
              visibility: 'internal',
              visibleFields: ['title', 'sprint_number'],
            },
            {
              kind: signalType === 'blocked' ? 'blocker' : signalType,
              sourceDocumentId: issueId,
              sourceType: 'issue',
              claim: signalType === 'blocked' ? 'Current blocker' : reason,
              excerpt: reason,
              visibility: 'internal',
              visibleFields: ['state', 'priority', 'updated_at', 'due_date'],
            },
          ];
          await pool.query(
            `INSERT INTO fleetgraph_findings (
               workspace_id, source_issue_id, source_sprint_id, dedupe_key,
               status, severity, confidence, title, summary, evidence_snapshot,
               recommended_action, draft_content, proposed_recipient, human_gate,
               trace_metadata, run_metadata, first_detected_at, last_detected_at, created_at, updated_at
             )
             VALUES (
               $1, $2, $3, $4, 'open', $5, $6, $7, $8, $9,
               $10, $11, $12, $13, $14, $15,
               NOW() - ($16::int * INTERVAL '1 hour'),
               NOW() - ($16::int * INTERVAL '1 hour'),
               NOW() - ($16::int * INTERVAL '1 hour'),
               NOW() - ($16::int * INTERVAL '1 hour')
             )`,
            [
              workspaceId,
              issueId,
              sprint.id,
              dedupeKey,
              signalType === 'at_risk' ? 'urgent' : 'high',
              0.86 + signalIndex * 0.025,
              `${scenario.title} (${signalType})`,
              reason,
              JSON.stringify(evidence),
              JSON.stringify({
                label: signalType === 'blocked' ? 'Unblock issue' : signalType === 'stale' ? 'Refresh plan' : 'Reduce risk',
                summary: 'Resolve this signal while preserving the other active attention context on the same issue.',
              }),
              JSON.stringify({
                subject: `${scenario.title} needs ${signalType} follow-up`,
                body: `Please update ${titleWithPrefix}. ${reason}`,
              }),
              JSON.stringify({
                role: 'issue_assignee',
                userId: assignee.id,
                displayName: assignee.name,
                rationale: 'Seeded multi-signal scenario routes all overlapping notifications to the issue assignee.',
              }),
              JSON.stringify({ required: false, reason: 'seed_multi_signal_demo_data' }),
              JSON.stringify({ mode: 'proactive', decision: 'create_finding', seed: true, multiSignal: true }),
              JSON.stringify({
                signalType,
                reason,
                uncertaintyNotes: [
                  'This source issue intentionally has multiple active FleetGraph findings.',
                  'Check whether the UI preserves the selected signal when several notifications share one document.',
                ],
              }),
              9 + i * 3 + signalIndex,
            ]
          );
          multiSignalFindingsCreated++;
        }
      }
    }

    if (multiSignalIssuesCreated > 0) {
      console.log(`✅ Created ${multiSignalIssuesCreated} multi-signal FleetGraph issues`);
    } else {
      console.log('ℹ️  All multi-signal FleetGraph issues already exist');
    }
    if (multiSignalFindingsCreated > 0) {
      console.log(`✅ Created ${multiSignalFindingsCreated} multi-signal FleetGraph findings`);
    } else {
      console.log('ℹ️  All multi-signal FleetGraph findings already exist');
    }

    // Create welcome/tutorial wiki document
    const existingTutorial = await pool.query<IdRow>(
      'SELECT id FROM documents WHERE workspace_id = $1 AND document_type = $2 AND title = $3',
      [workspaceId, 'wiki', WELCOME_DOCUMENT_TITLE]
    );

    let tutorialDocId: string;
    if (!existingTutorial.rows[0]) {
      // Insert the tutorial document with position=0 to ensure it appears first
      const tutorialResult = await pool.query<IdRow>(
        `INSERT INTO documents (workspace_id, document_type, title, content, position)
         VALUES ($1, 'wiki', $2, $3, 0)
         RETURNING id`,
        [workspaceId, WELCOME_DOCUMENT_TITLE, JSON.stringify(WELCOME_DOCUMENT_CONTENT)]
      );
      tutorialDocId = requireFirstRow(tutorialResult.rows).id;
      console.log('✅ Created welcome tutorial document');
    } else {
      tutorialDocId = requireFirstRow(existingTutorial.rows).id;
      console.log('ℹ️  Welcome tutorial already exists');
    }

    // Create nested wiki documents for tree navigation testing (Section 508 accessibility)
    const nestedDocs = [
      { title: 'Getting Started', parentId: tutorialDocId },
      { title: 'Advanced Topics', parentId: tutorialDocId },
    ];

    let nestedDocsCreated = 0;
    for (const doc of nestedDocs) {
      const existingDoc = await pool.query<IdRow>(
      'SELECT id FROM documents WHERE workspace_id = $1 AND document_type = $2 AND title = $3 AND parent_id = $4',
        [workspaceId, 'wiki', doc.title, doc.parentId]
      );

      if (!existingDoc.rows[0]) {
        await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, parent_id)
           VALUES ($1, 'wiki', $2, $3)`,
          [workspaceId, doc.title, doc.parentId]
        );
        nestedDocsCreated++;
      }
    }

    if (nestedDocsCreated > 0) {
      console.log(`✅ Created ${nestedDocsCreated} nested wiki documents`);
    }

    // Create additional standalone wiki documents for e2e testing
    // These ensure tests that require multiple documents don't skip
    const standaloneWikiDocs = [
      { title: 'Project Overview', content: 'Overview of the Ship project and its goals.' },
      { title: 'Architecture Guide', content: 'Technical architecture and design decisions.' },
      { title: 'API Reference', content: 'API endpoints and usage documentation.' },
      { title: 'Development Setup', content: 'How to set up your local development environment.' },
    ];

    let standaloneDocsCreated = 0;
    for (let i = 0; i < standaloneWikiDocs.length; i++) {
      const doc = standaloneWikiDocs[i]!;
      const existingDoc = await pool.query<IdRow>(
      'SELECT id FROM documents WHERE workspace_id = $1 AND document_type = $2 AND title = $3 AND parent_id IS NULL',
        [workspaceId, 'wiki', doc.title]
      );

      if (!existingDoc.rows[0]) {
        const contentJson = {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: doc.content }] }]
        };
        await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, content, position)
           VALUES ($1, 'wiki', $2, $3, $4)`,
          [workspaceId, doc.title, JSON.stringify(contentJson), i + 1]
        );
        standaloneDocsCreated++;
      }
    }

    if (standaloneDocsCreated > 0) {
      console.log(`✅ Created ${standaloneDocsCreated} standalone wiki documents`);
    }

    // Create sample standups for Ship Core sprints (tests the standup feed feature)
    const shipCoreSprints = sprints.filter(s => s.programId === shipCoreProgram.id);
    let standupsCreated = 0;

    // Add standups to current and recent sprints
    for (const sprint of shipCoreSprints) {
      if (sprint.number >= currentSprintNumber - 1 && sprint.number <= currentSprintNumber) {
        // Check if standups already exist for this sprint (via junction table)
        const existingStandups = await pool.query<IdRow>(
          `SELECT d.id FROM documents d
           JOIN document_associations da ON da.document_id = d.id
             AND da.related_id = $2 AND da.relationship_type = 'sprint'
           WHERE d.workspace_id = $1 AND d.document_type = 'standup'`,
          [workspaceId, sprint.id]
        );

        if (existingStandups.rows.length === 0) {
          // Create 2-3 standups per sprint from different team members
          const standupAuthors = allUsers.slice(0, 3);
          const standupMessages = [
            {
              content: {
                type: 'doc',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Yesterday: Finished implementing the sprint timeline UI component.' }] },
                  { type: 'paragraph', content: [{ type: 'text', text: 'Today: Working on the progress chart integration.' }] },
                  { type: 'paragraph', content: [{ type: 'text', text: 'Blockers: None' }] },
                ],
              },
            },
            {
              content: {
                type: 'doc',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Yesterday: Code review and bug fixes.' }] },
                  { type: 'paragraph', content: [{ type: 'text', text: 'Today: Starting on issue assignment flow.' }] },
                  { type: 'paragraph', content: [{ type: 'text', text: 'Blockers: Waiting on API spec clarification.' }] },
                ],
              },
            },
            {
              content: {
                type: 'doc',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Yesterday: Team sync and planning session.' }] },
                  { type: 'paragraph', content: [{ type: 'text', text: 'Today: Documentation and testing.' }] },
                  { type: 'paragraph', content: [{ type: 'text', text: 'Blockers: None' }] },
                ],
              },
            },
          ];

          for (let i = 0; i < standupAuthors.length; i++) {
            const author = standupAuthors[i]!;
            const message = standupMessages[i]!;
            const daysAgo = i; // Stagger the standups over recent days
            const properties = { author_id: author.id };

            // Create standup document without legacy sprint_id column
            const standupResult = await pool.query<IdRow>(
              `INSERT INTO documents (workspace_id, document_type, title, content, created_by, properties, created_at)
               VALUES ($1, 'standup', $2, $3, $4, $5, NOW() - INTERVAL '${daysAgo} days')
               RETURNING id`,
              [workspaceId, `Standup - ${author.name}`, JSON.stringify(message.content), author.id, JSON.stringify(properties)]
            );
            const standupId = requireFirstRow(standupResult.rows).id;

            // Create association to sprint via junction table
            await createAssociation(pool, standupId, sprint.id, 'sprint');

            standupsCreated++;
          }
        }
      }
    }

    if (standupsCreated > 0) {
      console.log(`✅ Created ${standupsCreated} standups`);
    } else {
      console.log('ℹ️  All standups already exist');
    }

    // Create sprint reviews for ALL completed sprints (not just recent ones)
    // This prevents "Complete review" action items for past sprints
    let sprintReviewsCreated = 0;

    const allPastSprints = sprints.filter(s => s.number < currentSprintNumber);
    for (const sprint of allPastSprints) {
      {
        // Check if review exists (via junction table)
        const existingReview = await pool.query<IdRow>(
          `SELECT d.id FROM documents d
           JOIN document_associations da ON da.document_id = d.id
             AND da.related_id = $2 AND da.relationship_type = 'sprint'
           WHERE d.workspace_id = $1 AND d.document_type = 'weekly_review'`,
          [workspaceId, sprint.id]
        );

        if (!existingReview.rows[0]) {
          const reviewContent = {
            type: 'doc',
            content: [
              { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What went well' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Team collaboration was excellent' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Met most of our sprint goals' }] }] },
              ]},
              { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What could be improved' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Better estimation on complex tasks' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'More frequent check-ins' }] }] },
              ]},
            ],
          };

          const owner = allUsers[sprint.number % allUsers.length]!;
          // Create sprint review document without legacy sprint_id column
          const reviewResult = await pool.query<IdRow>(
            `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
             VALUES ($1, 'weekly_review', $2, $3, $4)
             RETURNING id`,
            [workspaceId, `Week ${sprint.number} Review`, JSON.stringify(reviewContent), owner.id]
          );
          const reviewId = requireFirstRow(reviewResult.rows).id;

          // Create association to sprint via junction table
          await createAssociation(pool, reviewId, sprint.id, 'sprint');

          sprintReviewsCreated++;
        }
      }
    }

    if (sprintReviewsCreated > 0) {
      console.log(`✅ Created ${sprintReviewsCreated} week reviews`);
    } else {
      console.log('ℹ️  All week reviews already exist');
    }

    // Create weekly plans and retros for allocated people
    // This populates the Status Overview heatmap with realistic data
    let weeklyPlansCreated = 0;
    let weeklyRetrosCreated = 0;

    // Content pools for plans (varied, realistic per-person entries)
    const planContentPools = [
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
    const retroContentPools = [
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

    // Iterate through sprint assignments and create plans/retros
    for (let i = 0; i < sprintsToCreate.length; i++) {
      const sprintDef = sprintsToCreate[i]!;
      const matchingSprint = sprints.find(
        s => s.programId === sprintDef.programId && s.number === sprintDef.number
      );
      if (!matchingSprint) continue;

      const owner = allUsers[sprintDef.ownerIdx]!;
      const team = programTeams[sprintDef.programId]!;
      const otherIdx = team.find(idx => idx !== sprintDef.ownerIdx) ?? team[0]!;
      const otherUser = allUsers[otherIdx]!;
      const assignees = [
        { personDocId: owner.person_doc_id, userId: owner.id },
        { personDocId: otherUser.person_doc_id, userId: otherUser.id },
      ].filter(a => a.personDocId);

      const sprintOffset = sprintDef.number - currentSprintNumber;

      for (let p = 0; p < assignees.length; p++) {
        const assignee = assignees[p]!;
        const contentIdx = (i + p) % planContentPools.length;

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
                  JSON.stringify(makePlanContent(planContentPools[contentIdx]!)),
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
                  JSON.stringify(makeRetroContent(retroContentPools[contentIdx]!)),
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
                JSON.stringify(makePlanContent(planContentPools[contentIdx]!)),
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

    console.log('');
    console.log('🎉 Seed complete!');
    console.log('');
    console.log('Login credentials:');
    console.log('  Email: dev@ship.local');
    console.log('  Password: admin123');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
