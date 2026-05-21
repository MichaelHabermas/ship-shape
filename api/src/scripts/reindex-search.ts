import { pool } from '../db/client.js';
import { rebuildDocumentSearchIndex } from '../utils/tiptap-search.js';

async function main() {
  const workspaceArg = process.argv.find((arg) => arg.startsWith('--workspace-id='));
  const workspaceId = workspaceArg?.slice('--workspace-id='.length);

  const workspaces = workspaceId
    ? { rows: [{ id: workspaceId }] }
    : await pool.query<{ id: string }>(
      `SELECT id
       FROM workspaces
       WHERE archived_at IS NULL
       ORDER BY created_at ASC`
    );

  let totalIndexed = 0;
  for (const workspace of workspaces.rows) {
    const indexed = await rebuildDocumentSearchIndex(workspace.id);
    totalIndexed += indexed;
    console.log(`Reindexed ${indexed} document(s) for workspace ${workspace.id}`);
  }

  console.log(`Search reindex complete. ${totalIndexed} document(s) updated.`);
}

main()
  .catch((error) => {
    console.error('Search reindex failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
