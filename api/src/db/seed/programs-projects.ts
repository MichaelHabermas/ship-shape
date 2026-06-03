import { IdRow } from '../../test/pg-result.js';
import { requireFirstRow } from '../../utils/query-rows.js';
import {
  createAssociation,
  PROGRAM_TEAM_NAMES,
  PROGRAMS_TO_SEED,
  PROJECT_TEMPLATES,
  seedAt,
  SeedContext,
} from './seed-helpers.js';

export async function seedProgramsProjects(ctx: SeedContext): Promise<void> {
  const { pool, workspaceId, allUsers } = ctx;

  const programs: typeof ctx.programs = [];
  let programsCreated = 0;

  for (const prog of PROGRAMS_TO_SEED) {
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
  const programTeams: Record<string, number[]> = {};
  programs.forEach((prog, idx) => {
    const names = PROGRAM_TEAM_NAMES[idx] || ['Dev User'];
    programTeams[prog.id] = names.map(name => {
      const userIdx = allUsers.findIndex((u: { name: string }) => u.name === name);
      return userIdx >= 0 ? userIdx : 0;
    });
  });

  // Create projects for each program
  // Each project has ICE scores (Impact, Confidence, Ease) for prioritization (1-5 scale)
  const projects: typeof ctx.projects = [];
  let projectsCreated = 0;

  for (const program of programs) {
    for (const template of PROJECT_TEMPLATES) {
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
        const ownerIdx = (programs.indexOf(program) * PROJECT_TEMPLATES.length + PROJECT_TEMPLATES.indexOf(template)) % allUsers.length;
        const owner = seedAt(allUsers[ownerIdx], `allUsers[${ownerIdx}]`);

        // Calculate target date (2-4 weeks from now based on project type)
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + (PROJECT_TEMPLATES.indexOf(template) + 2) * 7);

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

  ctx.programs = programs;
  ctx.programTeams = programTeams;
  ctx.projects = projects;
}
