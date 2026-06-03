import { WELCOME_DOCUMENT_TITLE, WELCOME_DOCUMENT_CONTENT } from '../welcomeDocument.js';
import { IdRow, MaxTicketRow, SprintStartDateRow } from '../../test/pg-result.js';
import { requireFirstRow } from '../../utils/query-rows.js';
import {
  createAssociation,
  GENERIC_ISSUE_TEMPLATES,
  seedAt,
  SeedContext,
  SHIP_CORE_ISSUES,
  SPRINT_PLANS,
  SPRINT_REVIEW_CONTENT,
  SPRINT_SUCCESS_CRITERIA,
  STANDALONE_WIKI_DOCS,
  STANDUP_MESSAGES,
} from './seed-helpers.js';

export async function seedSprintsIssues(ctx: SeedContext): Promise<void> {
  const { pool, workspaceId, allUsers, programs, programTeams, projects } = ctx;

  // Get workspace sprint start date and calculate current sprint (1-week sprints)
  const wsResult = await pool.query<SprintStartDateRow>(
    'SELECT sprint_start_date FROM workspaces WHERE id = $1',
    [workspaceId]
  );
  const sprintStartDate = new Date(requireFirstRow(wsResult.rows).sprint_start_date);
  const today = new Date();
  const daysSinceStart = Math.floor((today.getTime() - sprintStartDate.getTime()) / (1000 * 60 * 60 * 24));
  const currentSprintNumber = Math.max(1, Math.floor(daysSinceStart / 7) + 1);
  ctx.currentSprintNumber = currentSprintNumber;

  // Create sprints for each program (current-3 to current+3)
  // Sprint owners and assignees come from the program's team (not global rotation)
  // Sprints are distributed among the program's projects
  const sprintsToCreate: typeof ctx.sprintsToCreate = [];
  for (const program of programs) {
    const team = seedAt(programTeams[program.id], `programTeams[${program.id}]`);
    // Get projects for this program to distribute sprints among them
    const programProjects = projects.filter(p => p.programId === program.id);
    let projectIdx = 0;
    for (let sprintNum = currentSprintNumber - 3; sprintNum <= currentSprintNumber + 3; sprintNum++) {
      if (sprintNum > 0) {
        // Round-robin assign sprints to projects within the program
        const project = seedAt(programProjects[projectIdx % programProjects.length], 'program project');
        // Owner rotates within the program's team
        const ownerIdx = seedAt(team[(sprintNum - 1) % team.length], 'sprint owner index');
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
  ctx.sprintsToCreate = sprintsToCreate;

  const sprints: typeof ctx.sprints = [];
  let sprintsCreated = 0;

  for (const sprint of sprintsToCreate) {
    const owner = seedAt(allUsers[sprint.ownerIdx], `allUsers[${sprint.ownerIdx}]`);

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

      // Calculate confidence based on sprint timing (future sprints have lower confidence)
      const sprintOffset = sprint.number - currentSprintNumber;
      let baseConfidence = 80;
      if (sprintOffset < 0) baseConfidence = 95; // Past sprints - high confidence (actual results)
      else if (sprintOffset === 0) baseConfidence = 75; // Current sprint - medium-high
      else if (sprintOffset === 1) baseConfidence = 60; // Next sprint - medium
      else baseConfidence = 40; // Future sprints - lower confidence

      // Other assignee comes from the same program team (not global +1)
      const team = seedAt(programTeams[sprint.programId], `programTeams[${sprint.programId}]`);
      const otherIdx = team.find(idx => idx !== sprint.ownerIdx) ?? seedAt(team[0], 'team[0]');
      const otherUser = seedAt(allUsers[otherIdx], `allUsers[${otherIdx}]`);
      // Set sprint status based on timing so action items don't fire for past sprints
      let sprintStatus: string | undefined;
      if (sprintOffset < 0) sprintStatus = 'completed';
      else if (sprintOffset === 0) sprintStatus = 'active';

      const sprintProperties: Record<string, unknown> = {
        sprint_number: sprint.number,
        owner_id: owner.id,
        project_id: sprint.projectId, // Required for team allocation
        assignee_ids: [owner.person_doc_id, otherUser.person_doc_id].filter(Boolean), // Person doc IDs for allocation
        plan: SPRINT_PLANS[sprint.number % SPRINT_PLANS.length],
        success_criteria: SPRINT_SUCCESS_CRITERIA[sprint.number % SPRINT_SUCCESS_CRITERIA.length],
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

  ctx.sprints = sprints;

  // Get Ship Core program for comprehensive sprint testing
  const shipCoreProgram = seedAt(programs.find(p => p.prefix === 'SHIP'), 'SHIP program');

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
  const shipCoreTeam = seedAt(programTeams[shipCoreProgram.id], 'shipCore team');
  for (let i = 0; i < SHIP_CORE_ISSUES.length; i++) {
    const issue = seedAt(SHIP_CORE_ISSUES[i], `shipCoreIssues[${i}]`);
    const shipCoreAssigneeIdx = seedAt(shipCoreTeam[i % shipCoreTeam.length], 'shipCoreTeam assignee index');
    const assignee = seedAt(allUsers[shipCoreAssigneeIdx], `allUsers[${shipCoreAssigneeIdx}]`);

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
      maxTickets[shipCoreProgram.id] = (maxTickets[shipCoreProgram.id] ?? 0) + 1;
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
          const randomProject = seedAt(programProjects[issuesCreated % programProjects.length], 'random program project');
          await createAssociation(pool, issueId, randomProject.id, 'project');
        }
      }

      issuesCreated++;
    }
  }

  // Seed generic issues for other programs
  const otherPrograms = programs.filter(p => p.prefix !== 'SHIP');
  for (const program of otherPrograms) {
    const team = seedAt(programTeams[program.id], `programTeams[${program.id}]`);
    for (let i = 0; i < GENERIC_ISSUE_TEMPLATES.length; i++) {
      const template = seedAt(GENERIC_ISSUE_TEMPLATES[i], `genericIssueTemplates[${i}]`);
      const memberIdx = seedAt(team[i % team.length], 'generic issue team member index');
      const assignee = seedAt(allUsers[memberIdx], `allUsers[${memberIdx}]`);

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
        maxTickets[program.id] = (maxTickets[program.id] ?? 0) + 1;
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
            const randomProject = seedAt(programProjects[issuesCreated % programProjects.length], 'random program project');
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
  let standaloneDocsCreated = 0;
  for (let i = 0; i < STANDALONE_WIKI_DOCS.length; i++) {
    const doc = seedAt(STANDALONE_WIKI_DOCS[i], `standaloneWikiDocs[${i}]`);
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

        for (let i = 0; i < standupAuthors.length; i++) {
          const author = seedAt(standupAuthors[i], `standupAuthors[${i}]`);
          const message = seedAt(STANDUP_MESSAGES[i], `standupMessages[${i}]`);
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
        const owner = seedAt(allUsers[sprint.number % allUsers.length], 'standup sprint owner');
        // Create sprint review document without legacy sprint_id column
        const reviewResult = await pool.query<IdRow>(
          `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
           VALUES ($1, 'weekly_review', $2, $3, $4)
           RETURNING id`,
          [workspaceId, `Week ${sprint.number} Review`, JSON.stringify(SPRINT_REVIEW_CONTENT), owner.id]
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
}
