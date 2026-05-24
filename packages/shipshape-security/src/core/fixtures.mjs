import { marker } from '../fixtures/payloads.mjs';

export async function authMe(client) {
  const result = await client.api('/api/auth/me');
  const user = result.json?.data?.user || result.json?.user;
  if (!user?.id) throw new Error(`auth/me failed with HTTP ${result.status}`);
  return user;
}

export async function resolvePersonId(client, userId) {
  const result = await client.api('/api/documents?type=person');
  const docs = Array.isArray(result.json) ? result.json : result.json?.data || [];
  const person = docs.find((doc) => doc.properties?.user_id === userId);
  if (!person?.id) throw new Error(`No person document for user ${userId}`);
  return person.id;
}

export async function pickProgram(client, name = 'Ship Core') {
  const bootstrap = await client.api('/api/bootstrap');
  const programs = bootstrap.json?.data?.programs || bootstrap.json?.programs || [];
  const program = programs.find((item) => item.name === name) || programs[0];
  if (!program?.id) throw new Error('No program available for probe fixture');
  return program;
}

export async function pickSprintDocument(client, programId) {
  const result = await client.api('/api/documents?type=sprint');
  const docs = Array.isArray(result.json) ? result.json : result.json?.data || [];
  const sprint =
    docs.find((doc) => doc.properties?.program_id === programId) ||
    docs.find((doc) => doc.document_type === 'sprint') ||
    docs[0];
  if (!sprint?.id) throw new Error('No sprint document available for probe fixture');
  return sprint;
}

export async function createProject(client, config, titleSuffix = 'probe') {
  const result = await client.api('/api/documents', {
    method: 'POST',
    body: {
      title: `${marker(config.runId)} ${titleSuffix}`,
      document_type: 'project',
      visibility: 'workspace',
    },
  });
  const id = result.json?.id || result.json?.data?.id;
  if (!id) throw new Error(`Failed to create project (HTTP ${result.status})`);
  return id;
}

export async function createWeeklyPlan(client, { personId, projectId, weekNumber = 1 }) {
  const result = await client.api('/api/weekly-plans', {
    method: 'POST',
    body: {
      person_id: personId,
      project_id: projectId,
      week_number: weekNumber,
    },
  });
  const plan = result.json?.data || result.json;
  if (!plan?.id) throw new Error(`Failed to create weekly plan (HTTP ${result.status})`);
  return plan;
}

export async function createPendingLocalUpload(client, config, sizeBytes = 32) {
  const create = await client.api('/api/files/upload', {
    method: 'POST',
    body: {
      filename: `${marker(config.runId)}-authz-probe.bin`.replace(/[^\w.-]+/g, '_'),
      mimeType: 'application/octet-stream',
      sizeBytes,
    },
  });
  const fileId = create.json?.fileId;
  const uploadUrl = create.json?.uploadUrl;
  if (!fileId || !uploadUrl) {
    const detail =
      create.json?.error ||
      create.json?.message ||
      (create.text && create.text.length < 240 ? create.text.trim() : '');
    const suffix = detail ? `: ${detail}` : '';
    throw new Error(`Failed to create pending upload (HTTP ${create.status})${suffix}`);
  }
  return { fileId, uploadUrl, create };
}

export function isDeniedStatus(status) {
  return status === 400 || status === 403 || status === 404;
}

export function memberReady(clients) {
  return clients.member.cookies.size > 0;
}
