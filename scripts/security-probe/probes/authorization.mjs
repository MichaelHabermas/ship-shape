import { websocketProbe } from '../lib/ws-raw.mjs';
import { fail, finding, pass, skip } from '../lib/result-model.mjs';
import { runSelectedProbes } from '../lib/probe-selection.mjs';
import { fingerprintForFinding } from '../lib/finding-registry.mjs';
import {
  authMe,
  createPendingLocalUpload,
  createProject,
  createWeeklyPlan,
  isDeniedStatus,
  memberReady,
  pickProgram,
  pickSprintDocument,
  resolvePersonId,
} from '../lib/fixtures.mjs';

function authzFinding({
  id,
  probeId,
  title,
  severity,
  ledgerId,
  owasp,
  expected,
  observed,
  fixCandidate,
}) {
  return finding({
    id,
    probeId,
    title,
    severity,
    ledgerId,
    owasp,
    fingerprint: fingerprintForFinding(probeId, id),
    category: 'authorization',
    expected,
    observed,
    fixCandidate,
    evidence: { reproduction: [`pnpm security:probe -- --probe ${probeId}`] },
  });
}

export async function authorizationProbes(context) {
  return runSelectedProbes(context, [
    {
      id: 'authorization-governance-properties-injection',
      name: 'Member cannot forge plan_approval via documents PATCH',
      run: governancePropertiesInjection,
      requiresWrite: true,
    },
    {
      id: 'authorization-governance-accountable-self-assign',
      name: 'Member cannot self-assign accountable_id on program',
      run: governanceAccountableSelfAssign,
      requiresWrite: true,
    },
    {
      id: 'authorization-governance-week-status-bypass',
      name: 'Member cannot complete sprint via ungoverned status PATCH',
      run: governanceWeekStatusBypass,
      requiresWrite: true,
    },
    {
      id: 'authorization-weekly-plan-idor-documents',
      name: 'Member cannot access peer weekly plan via documents API',
      run: weeklyPlanIdorDocuments,
      requiresWrite: true,
    },
    {
      id: 'authorization-weekly-plan-idor-websocket',
      name: 'Member cannot join peer weekly plan collaboration room',
      run: weeklyPlanIdorWebsocket,
      requiresWrite: true,
    },
    {
      id: 'authorization-websocket-origin-reject',
      name: 'Cross-origin WebSocket upgrade rejected',
      run: websocketOriginReject,
      requiresWrite: true,
    },
    {
      id: 'authorization-file-upload-hijack-denied',
      name: 'Member cannot complete another user pending upload',
      run: fileUploadHijackDenied,
      requiresWrite: true,
    },
    {
      id: 'authorization-bulk-issue-foreign-target',
      name: 'Bulk issue update does not mutate inaccessible foreign IDs',
      run: bulkIssueForeignTarget,
      requiresWrite: true,
    },
    {
      id: 'authorization-dashboard-private-metadata',
      name: 'Dashboard my-focus does not expose private project titles to unrelated members',
      run: dashboardPrivateMetadata,
      requiresWrite: true,
    },
    {
      id: 'authorization-file-document-scope',
      name: 'File serve respects parent document visibility',
      run: fileDocumentScope,
      requiresWrite: true,
    },
  ]);
}

async function governancePropertiesInjection({ clients }) {
  if (!memberReady(clients)) {
    return skip('authorization-governance-properties-injection', 'Member cannot forge plan_approval via documents PATCH', 'member login unavailable');
  }
  const program = await pickProgram(clients.admin);
  const sprint = await pickSprintDocument(clients.admin, program.id);
  const memberUser = await authMe(clients.member);
  const patch = await clients.member.api(`/api/documents/${sprint.id}`, {
    method: 'PATCH',
    body: {
      properties: {
        plan_approval: {
          state: 'approved',
          approved_by: memberUser.id,
          approved_at: new Date().toISOString(),
          approved_version_id: null,
        },
      },
    },
  });
  if (isDeniedStatus(patch.status)) {
    return pass('authorization-governance-properties-injection', 'Member cannot forge plan_approval via documents PATCH');
  }
  return fail(
    'authorization-governance-properties-injection',
    'Member cannot forge plan_approval via documents PATCH',
    authzFinding({
      id: 'probe-governance-properties-injection',
      probeId: 'authorization-governance-properties-injection',
      title: 'Member forged plan_approval via documents PATCH',
      severity: 'critical',
      ledgerId: 'SS-FIND-001',
      owasp: 'A01',
      expected: 'PATCH /api/documents/:sprintId with plan_approval returns 400 or 403.',
      observed: `Received HTTP ${patch.status}.`,
      fixCandidate: 'Denylist governance keys on generic document PATCH merge paths.',
    })
  );
}

async function governanceAccountableSelfAssign({ clients }) {
  if (!memberReady(clients)) {
    return skip('authorization-governance-accountable-self-assign', 'Member cannot self-assign accountable_id on program', 'member login unavailable');
  }
  const program = await pickProgram(clients.admin);
  const memberUser = await authMe(clients.member);
  const patch = await clients.member.api(`/api/programs/${program.id}`, {
    method: 'PATCH',
    body: { accountable_id: memberUser.id },
  });
  if (isDeniedStatus(patch.status)) {
    return pass('authorization-governance-accountable-self-assign', 'Member cannot self-assign accountable_id on program');
  }
  return fail(
    'authorization-governance-accountable-self-assign',
    'Member cannot self-assign accountable_id on program',
    authzFinding({
      id: 'probe-governance-accountable-self-assign',
      probeId: 'authorization-governance-accountable-self-assign',
      title: 'Member self-assigned accountable_id on program',
      severity: 'critical',
      ledgerId: 'SS-FIND-002',
      owasp: 'A01',
      expected: 'Member PATCH accountable_id to self returns 403.',
      observed: `Received HTTP ${patch.status}.`,
      fixCandidate: 'Admin-gate RACI field mutations on programs and documents.',
    })
  );
}

async function governanceWeekStatusBypass({ clients }) {
  if (!memberReady(clients)) {
    return skip('authorization-governance-week-status-bypass', 'Member cannot complete sprint via ungoverned status PATCH', 'member login unavailable');
  }
  const program = await pickProgram(clients.admin);
  const sprint = await pickSprintDocument(clients.admin, program.id);
  const documentPatch = await clients.member.api(`/api/documents/${sprint.id}`, {
    method: 'PATCH',
    body: { status: 'completed' },
  });
  const weekPatch = await clients.member.api(`/api/weeks/${sprint.id}`, {
    method: 'PATCH',
    body: { status: 'completed' },
  });
  const denied =
    isDeniedStatus(documentPatch.status) && isDeniedStatus(weekPatch.status);
  if (denied) {
    return pass('authorization-governance-week-status-bypass', 'Member cannot complete sprint via ungoverned status PATCH');
  }
  return fail(
    'authorization-governance-week-status-bypass',
    'Member cannot complete sprint via ungoverned status PATCH',
    authzFinding({
      id: 'probe-governance-week-status-bypass',
      probeId: 'authorization-governance-week-status-bypass',
      title: 'Member bypassed week lifecycle via status PATCH',
      severity: 'critical',
      ledgerId: 'SS-FIND-003',
      owasp: 'A01',
      expected: 'Member PATCH sprint status to completed on /api/documents and /api/weeks returns 403.',
      observed: `documents HTTP ${documentPatch.status}, weeks HTTP ${weekPatch.status}.`,
      fixCandidate: 'Remove ungoverned status from generic PATCH; enforce lifecycle routes only.',
    })
  );
}

async function weeklyPlanIdorDocuments({ clients, config }) {
  if (!memberReady(clients)) {
    return skip('authorization-weekly-plan-idor-documents', 'Member cannot access peer weekly plan via documents API', 'member login unavailable');
  }
  const adminUser = await authMe(clients.admin);
  const memberUser = await authMe(clients.member);
  const adminPersonId = await resolvePersonId(clients.admin, adminUser.id);
  const memberPersonId = await resolvePersonId(clients.member, memberUser.id);
  const projectId = await createProject(clients.admin, config, 'weekly-plan-idor');
  const victimPlan = await createWeeklyPlan(clients.admin, {
    personId: adminPersonId,
    projectId,
    weekNumber: 9000 + Math.floor(Math.random() * 1000),
  });
  const getResult = await clients.member.api(`/api/documents/${victimPlan.id}`);
  const patchResult = await clients.member.api(`/api/documents/${victimPlan.id}`, {
    method: 'PATCH',
    body: { title: 'probe-idor-attempt' },
  });
  if (isDeniedStatus(getResult.status) && isDeniedStatus(patchResult.status)) {
    return pass('authorization-weekly-plan-idor-documents', 'Member cannot access peer weekly plan via documents API', {
      victimPersonId: adminPersonId,
      attackerPersonId: memberPersonId,
    });
  }
  return fail(
    'authorization-weekly-plan-idor-documents',
    'Member cannot access peer weekly plan via documents API',
    authzFinding({
      id: 'probe-weekly-plan-idor-documents',
      probeId: 'authorization-weekly-plan-idor-documents',
      title: 'Member accessed peer weekly plan via documents API',
      severity: 'high',
      ledgerId: 'SS-FIND-004',
      owasp: 'A01',
      expected: 'Member GET/PATCH on another user weekly plan returns 403 or 404.',
      observed: `GET HTTP ${getResult.status}, PATCH HTTP ${patchResult.status}.`,
      fixCandidate: 'Enforce person ownership on weekly_plan via generic documents REST.',
    })
  );
}

async function weeklyPlanIdorWebsocket({ clients, config }) {
  if (!memberReady(clients)) {
    return skip('authorization-weekly-plan-idor-websocket', 'Member cannot join peer weekly plan collaboration room', 'member login unavailable');
  }
  const adminUser = await authMe(clients.admin);
  const adminPersonId = await resolvePersonId(clients.admin, adminUser.id);
  const projectId = await createProject(clients.admin, config, 'weekly-plan-ws-idor');
  const victimPlan = await createWeeklyPlan(clients.admin, {
    personId: adminPersonId,
    projectId,
    weekNumber: 9100 + Math.floor(Math.random() * 1000),
  });
  const result = await websocketProbe({
    wsUrl: config.wsUrl,
    path: `/collaboration/weekly_plan:${victimPlan.id}`,
    cookieHeader: clients.member.cookieHeader(),
  });
  if (result.status === 403 || result.status === 404) {
    return pass('authorization-weekly-plan-idor-websocket', 'Member cannot join peer weekly plan collaboration room');
  }
  return fail(
    'authorization-weekly-plan-idor-websocket',
    'Member cannot join peer weekly plan collaboration room',
    authzFinding({
      id: 'probe-weekly-plan-idor-websocket',
      probeId: 'authorization-weekly-plan-idor-websocket',
      title: 'Member joined peer weekly plan collaboration room',
      severity: 'high',
      ledgerId: 'SS-FIND-005',
      owasp: 'A01',
      expected: 'WebSocket upgrade to peer weekly_plan room returns 403.',
      observed: `Upgrade result: ${JSON.stringify(result)}`,
      fixCandidate: 'Apply person ownership checks in canAccessDocumentForCollab for weekly_plan.',
    })
  );
}

async function websocketOriginReject({ clients, config }) {
  const doc = await clients.admin.api('/api/documents', {
    method: 'POST',
    body: { title: 'ws-origin-probe', document_type: 'wiki', visibility: 'workspace' },
  });
  const docId = doc.json?.id || doc.json?.data?.id;
  if (!docId) {
    return skip('authorization-websocket-origin-reject', 'Cross-origin WebSocket upgrade rejected', 'could not create probe document');
  }
  const result = await websocketProbe({
    wsUrl: config.wsUrl,
    path: `/collaboration/wiki:${docId}`,
    cookieHeader: clients.admin.cookieHeader(),
    originHeader: 'https://attacker.example',
  });
  if (result.status === 403) {
    return pass('authorization-websocket-origin-reject', 'Cross-origin WebSocket upgrade rejected');
  }
  return fail(
    'authorization-websocket-origin-reject',
    'Cross-origin WebSocket upgrade rejected',
    authzFinding({
      id: 'probe-websocket-origin-reject',
      probeId: 'authorization-websocket-origin-reject',
      title: 'Cross-origin WebSocket upgrade was accepted',
      severity: 'high',
      ledgerId: 'SS-FIND-026',
      owasp: 'A01',
      expected: 'WebSocket upgrade with attacker Origin and valid session returns 403.',
      observed: `Upgrade result: ${JSON.stringify(result)}`,
      fixCandidate: 'Validate Origin header on collaboration and events WebSocket upgrades.',
    })
  );
}

async function fileUploadHijackDenied({ clients, config }) {
  if (!memberReady(clients)) {
    return skip('authorization-file-upload-hijack-denied', 'Member cannot complete another user pending upload', 'member login unavailable');
  }
  const { fileId } = await createPendingLocalUpload(clients.admin, config);
  const body = Buffer.alloc(32, 0);
  const hijack = await clients.member.request(`/api/files/${fileId}/local-upload`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      ...(clients.member.csrfToken ? { 'x-csrf-token': clients.member.csrfToken } : {}),
    },
    body,
  });
  if (isDeniedStatus(hijack.status)) {
    return pass('authorization-file-upload-hijack-denied', 'Member cannot complete another user pending upload');
  }
  return fail(
    'authorization-file-upload-hijack-denied',
    'Member cannot complete another user pending upload',
    authzFinding({
      id: 'probe-file-upload-hijack-denied',
      probeId: 'authorization-file-upload-hijack-denied',
      title: 'Member completed another user pending upload',
      severity: 'high',
      ledgerId: 'SS-FIND-025',
      owasp: 'A01',
      expected: 'local-upload for pending file owned by another user returns 403.',
      observed: `Received HTTP ${hijack.status}.`,
      fixCandidate: 'Require uploaded_by matches session user on complete/upload paths.',
    })
  );
}

async function bulkIssueForeignTarget({ clients, config }) {
  if (!memberReady(clients)) {
    return skip('authorization-bulk-issue-foreign-target', 'Bulk issue update does not mutate inaccessible foreign IDs', 'member login unavailable');
  }
  const owned = await clients.member.api('/api/documents', {
    method: 'POST',
    body: {
      title: `${config.runId} owned issue`,
      document_type: 'issue',
      visibility: 'workspace',
    },
  });
  const ownedId = owned.json?.id || owned.json?.data?.id;
  if (!ownedId) {
    return skip('authorization-bulk-issue-foreign-target', 'Bulk issue update does not mutate inaccessible foreign IDs', 'could not create owned issue');
  }
  const foreignId = '00000000-0000-4000-8000-000000000099';
  const bulk = await clients.member.api('/api/issues/bulk', {
    method: 'POST',
    body: {
      ids: [ownedId, foreignId],
      action: 'update',
      updates: { state: 'in_progress' },
    },
  });
  const updated = bulk.json?.updated || [];
  const failed = bulk.json?.failed || [];
  const updatedIds = updated.map((row) => row.id);
  if (!updatedIds.includes(foreignId) && failed.some((row) => row.id === foreignId)) {
    return pass('authorization-bulk-issue-foreign-target', 'Bulk issue update does not mutate inaccessible foreign IDs');
  }
  return fail(
    'authorization-bulk-issue-foreign-target',
    'Bulk issue update does not mutate inaccessible foreign IDs',
    authzFinding({
      id: 'probe-bulk-issue-foreign-target',
      probeId: 'authorization-bulk-issue-foreign-target',
      title: 'Bulk issue update mutated or accepted inaccessible foreign ID',
      severity: 'medium',
      ledgerId: 'SS-FIND-007',
      owasp: 'A01',
      expected: 'Foreign issue ID appears in failed list, not updated list.',
      observed: `updated=${JSON.stringify(updatedIds)}, failed=${JSON.stringify(failed)}`,
      fixCandidate: 'Validate visibility on bulk issue association targets.',
    })
  );
}

async function dashboardPrivateMetadata({ clients, config }) {
  if (!memberReady(clients)) {
    return skip(
      'authorization-dashboard-private-metadata',
      'Dashboard my-focus does not expose private project titles to unrelated members',
      'member login unavailable'
    );
  }
  const privateProject = await clients.admin.api('/api/documents', {
    method: 'POST',
    body: {
      title: `${config.runId} private probe project`,
      document_type: 'project',
      visibility: 'private',
    },
  });
  const privateId = privateProject.json?.id || privateProject.json?.data?.id;
  if (!privateId) {
    return skip(
      'authorization-dashboard-private-metadata',
      'Dashboard my-focus does not expose private project titles to unrelated members',
      'could not create private project'
    );
  }
  const focus = await clients.member.api('/api/dashboard/my-focus');
  const text = focus.text || '';
  if (text.includes(privateId) || /private probe project/i.test(text)) {
    return fail(
      'authorization-dashboard-private-metadata',
      'Dashboard my-focus does not expose private project titles to unrelated members',
      authzFinding({
        id: 'probe-dashboard-private-metadata',
        probeId: 'authorization-dashboard-private-metadata',
        title: 'Dashboard my-focus leaked private project metadata',
        severity: 'medium',
        ledgerId: 'SS-FIND-010',
        owasp: 'A01',
        expected: 'Member my-focus response excludes unrelated private project identifiers/titles.',
        observed: 'Response referenced private probe project.',
        fixCandidate: 'Apply visibility filters on dashboard joins.',
      })
    );
  }
  return pass('authorization-dashboard-private-metadata', 'Dashboard my-focus does not expose private project titles to unrelated members');
}

async function fileDocumentScope({ clients, config }) {
  if (!memberReady(clients)) {
    return skip('authorization-file-document-scope', 'File serve respects parent document visibility', 'member login unavailable');
  }
  const privateDoc = await clients.admin.api('/api/documents', {
    method: 'POST',
    body: {
      title: `${config.runId} private file parent`,
      document_type: 'wiki',
      visibility: 'private',
    },
  });
  const docId = privateDoc.json?.id || privateDoc.json?.data?.id;
  if (!docId) {
    return skip('authorization-file-document-scope', 'File serve respects parent document visibility', 'could not create private document');
  }
  const { fileId } = await createPendingLocalUpload(clients.admin, config);
  const upload = await clients.admin.request(`/api/files/${fileId}/local-upload`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      ...(clients.admin.csrfToken ? { 'x-csrf-token': clients.admin.csrfToken } : {}),
    },
    body: Buffer.alloc(32, 0),
  });
  if (upload.status >= 400) {
    return skip('authorization-file-document-scope', 'File serve respects parent document visibility', `admin upload failed HTTP ${upload.status}`);
  }
  const serve = await clients.member.api(`/api/files/${fileId}/serve`);
  if (isDeniedStatus(serve.status)) {
    return pass('authorization-file-document-scope', 'File serve respects parent document visibility');
  }
  return fail(
    'authorization-file-document-scope',
    'File serve respects parent document visibility',
    authzFinding({
      id: 'probe-file-document-scope',
      probeId: 'authorization-file-document-scope',
      title: 'Member served file without parent document access',
      severity: 'medium',
      ledgerId: 'SS-FIND-008',
      owasp: 'A01',
      expected: 'Member without private document access cannot GET /api/files/:id/serve.',
      observed: `Serve returned HTTP ${serve.status}.`,
      fixCandidate: 'Enforce document visibility when serving workspace files.',
    })
  );
}
