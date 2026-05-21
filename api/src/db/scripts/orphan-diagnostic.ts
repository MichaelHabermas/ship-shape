/**
 * Orphan Diagnostic Script
 * Identifies orphaned entities after migration 027 (document_associations)
 *
 * Usage: npx tsx api/src/db/scripts/orphan-diagnostic.ts
 * Or add to package.json: "db:orphan-check": "tsx api/src/db/scripts/orphan-diagnostic.ts"
 */

import pg from 'pg';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config({ path: join(__dirname, '../../../.env.local') });
config({ path: join(__dirname, '../../../.env') });

const { Pool } = pg;

async function runDiagnostic() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  console.log('\n========================================');
  console.log('ORPHAN DIAGNOSTIC REPORT');
  console.log('Post-migration 027 (document_associations)');
  console.log('========================================\n');

  try {
    // 1. Dangling associations
    console.log('Checking for dangling associations...');
    const danglingResult = await pool.query(`
      SELECT
        da.id AS association_id,
        da.document_id,
        da.related_id,
        da.relationship_type,
        d.title AS document_title,
        d.document_type,
        w.name AS workspace_name
      FROM document_associations da
      JOIN documents d ON da.document_id = d.id
      JOIN workspaces w ON d.workspace_id = w.id
      LEFT JOIN documents d2 ON da.related_id = d2.id
      WHERE d2.id IS NULL
    `);

    if (danglingResult.rows.length > 0) {
      console.log(`\n[CRITICAL] Found ${danglingResult.rows.length} dangling associations:\n`);
      console.table(
        danglingResult.rows.map((r) => ({
          workspace: r.workspace_name,
          document: r.document_title,
          type: r.document_type,
          points_to: r.related_id,
          relationship: r.relationship_type,
        }))
      );
    } else {
      console.log('[OK] No dangling associations found.\n');
    }

    // 2. Issues without project association
    console.log('Checking for issues without project associations...');
    const issuesWithoutProject = await pool.query(`
      SELECT
        d.id,
        d.title,
        w.name AS workspace_name,
        d.created_at,
        d.properties->>'state' AS state,
        d.archived_at IS NOT NULL AS is_archived,
        EXISTS (
          SELECT 1 FROM document_associations da
          WHERE da.document_id = d.id AND da.relationship_type = 'sprint'
        ) AS has_sprint
      FROM documents d
      JOIN workspaces w ON d.workspace_id = w.id
      WHERE d.document_type = 'issue'
        AND d.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM document_associations da
          WHERE da.document_id = d.id AND da.relationship_type = 'project'
        )
      ORDER BY w.name, d.created_at DESC
    `);

    if (issuesWithoutProject.rows.length > 0) {
      console.log(`\n[REVIEW] Found ${issuesWithoutProject.rows.length} issues without project:\n`);
      console.table(
        issuesWithoutProject.rows.map((r) => ({
          workspace: r.workspace_name,
          title: r.title.substring(0, 40) + (r.title.length > 40 ? '...' : ''),
          state: r.state,
          has_sprint: r.has_sprint ? 'Yes' : 'No',
          archived: r.is_archived ? 'Yes' : 'No',
          created: r.created_at.toISOString().split('T')[0],
        }))
      );
    } else {
      console.log('[OK] All issues have project associations.\n');
    }

    // 3. Sprints without project association
    console.log('Checking for sprints without project associations...');
    const sprintsWithoutProject = await pool.query(`
      SELECT
        d.id,
        d.title,
        w.name AS workspace_name,
        d.created_at,
        d.properties->>'sprint_status' AS sprint_status,
        (
          SELECT COUNT(*) FROM document_associations da
          JOIN documents issue ON da.document_id = issue.id
          WHERE da.related_id = d.id
            AND da.relationship_type = 'sprint'
            AND issue.document_type = 'issue'
        ) AS issue_count
      FROM documents d
      JOIN workspaces w ON d.workspace_id = w.id
      WHERE d.document_type = 'sprint'
        AND d.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM document_associations da
          WHERE da.document_id = d.id AND da.relationship_type = 'project'
        )
      ORDER BY w.name, d.created_at DESC
    `);

    if (sprintsWithoutProject.rows.length > 0) {
      console.log(`\n[REVIEW] Found ${sprintsWithoutProject.rows.length} sprints without project:\n`);
      console.table(
        sprintsWithoutProject.rows.map((r) => ({
          workspace: r.workspace_name,
          title: r.title.substring(0, 30) + (r.title.length > 30 ? '...' : ''),
          status: r.sprint_status,
          issues: r.issue_count,
          created: r.created_at.toISOString().split('T')[0],
        }))
      );
    } else {
      console.log('[OK] All sprints have project associations.\n');
    }

    // 4. Projects without program
    console.log('Checking for projects without program...');
    const projectsWithoutProgram = await pool.query(`
      SELECT
        d.id,
        d.title,
        w.name AS workspace_name,
        d.created_at,
        d.properties->>'prefix' AS prefix,
        (
          SELECT COUNT(*) FROM document_associations da
          JOIN documents issue ON da.document_id = issue.id
          WHERE da.related_id = d.id
            AND da.relationship_type = 'project'
            AND issue.document_type = 'issue'
        ) AS issue_count
      FROM documents d
      JOIN workspaces w ON d.workspace_id = w.id
      WHERE d.document_type = 'project'
        AND d.deleted_at IS NULL
        AND d.program_id IS NULL
      ORDER BY w.name, d.created_at DESC
    `);

    if (projectsWithoutProgram.rows.length > 0) {
      console.log(`\n[INFO] Found ${projectsWithoutProgram.rows.length} projects without program:\n`);
      console.table(
        projectsWithoutProgram.rows.map((r) => ({
          workspace: r.workspace_name,
          title: r.title.substring(0, 30) + (r.title.length > 30 ? '...' : ''),
          prefix: r.prefix,
          issues: r.issue_count,
          created: r.created_at.toISOString().split('T')[0],
        }))
      );
    } else {
      console.log('[OK] All projects belong to a program.\n');
    }

    // Summary
    console.log('\n========================================');
    console.log('SUMMARY');
    console.log('========================================');
    console.log(`Dangling associations:     ${danglingResult.rows.length}`);
    console.log(`Issues without project:    ${issuesWithoutProject.rows.length}`);
    console.log(`Sprints without project:   ${sprintsWithoutProject.rows.length}`);
    console.log(`Projects without program:  ${projectsWithoutProgram.rows.length}`);
    console.log('========================================\n');

    // Output IDs for remediation
    if (
      danglingResult.rows.length > 0 ||
      issuesWithoutProject.rows.length > 0 ||
      sprintsWithoutProject.rows.length > 0
    ) {
      console.log('Entity IDs for remediation:');
      console.log('---');

      if (danglingResult.rows.length > 0) {
        console.log('\nDangling association IDs:');
        danglingResult.rows.forEach((r) => console.log(`  ${r.association_id}`));
      }

      if (issuesWithoutProject.rows.length > 0) {
        console.log('\nIssue IDs without project:');
        issuesWithoutProject.rows.forEach((r) => console.log(`  ${r.id}  # ${r.title.substring(0, 50)}`));
      }

      if (sprintsWithoutProject.rows.length > 0) {
        console.log('\nSprint IDs without project:');
        sprintsWithoutProject.rows.forEach((r) => console.log(`  ${r.id}  # ${r.title}`));
      }

      console.log('\nUse orphan-remediation.sql with these IDs to fix issues.');
    }
  } finally {
    await pool.end();
  }
}

runDiagnostic().catch((err) => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
