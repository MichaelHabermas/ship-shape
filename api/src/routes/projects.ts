import { Router, Request, Response } from 'express';
import { getVisibilityContext } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  guardDocumentIdParam,
  requireProjectRead,
} from '../security/route-capability.js';
import { principalFromRequest } from '../security/principal.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { sendInternalError, sendValidationError } from '../utils/route-http.js';
import {
  createProjectSchema,
  createProjectSprintSchema,
  projectRetroSchema,
  updateProjectSchema,
} from '../schemas/projects.js';
import {
  approveProjectPlan,
  approveProjectRetro,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
  type ProjectServiceResult,
} from '../services/projects-service.js';
import {
  createProjectRetro,
  getProjectRetro,
  updateProjectRetro,
  type ProjectRetroResult,
} from '../services/project-retro-service.js';
import {
  createProjectSprint,
  listProjectIssues,
  listProjectSprints,
  type ProjectNestedResult,
} from '../services/project-nested-service.js';

const router = Router();

async function guardProjectRead(
  req: Request,
  res: Response,
  rawId: string | string[] | undefined
): Promise<string | null> {
  const id = guardDocumentIdParam(res, rawId, 'Project not found');
  if (!id) return null;
  if (!(await requireProjectRead(req, res, id))) {
    return null;
  }
  return id;
}

function guardProjectId(
  res: Response,
  rawId: string | string[] | undefined
): string | null {
  return guardDocumentIdParam(res, rawId, 'Project not found');
}

function respondProject<T>(res: Response, result: ProjectServiceResult<T>): void {
  if (!result.ok) {
    res.status(result.status).json(result.body);
    return;
  }
  if (result.status === 301 && 'converted' in result) {
    res.set('X-Converted-Type', result.converted.documentType);
    res.set('X-Converted-To', result.converted.id);
    res.redirect(301, `/api/${result.converted.documentType}s/${result.converted.id}`);
    return;
  }
  if (result.status === 204) {
    res.status(204).send();
    return;
  }
  if ('body' in result) {
    res.status(result.status).json(result.body);
  }
}

function respondRetro<T>(res: Response, result: ProjectRetroResult<T>): void {
  if (!result.ok) {
    res.status(result.status).json(result.body);
    return;
  }
  res.status(result.status).json(result.body);
}

function respondNested<T>(res: Response, result: ProjectNestedResult<T>): void {
  if (!result.ok) {
    res.status(result.status).json(result.body);
    return;
  }
  res.status(result.status).json(result.body);
}

router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const includeArchived = req.query.archived === 'true';
    const sortField = (req.query.sort as string) || 'ice_score';
    const sortDir = (req.query.dir as string) === 'asc' ? 'ASC' : 'DESC';
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    respondProject(res, await listProjects({
      workspaceId,
      userId,
      isAdmin,
      includeArchived,
      sortField,
      sortDir,
    }));
  } catch (err) {
    sendInternalError(res, err, 'List projects error:');
  }
});

router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await guardProjectRead(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    respondProject(res, await getProject({
      projectId: id,
      workspaceId,
      userId,
      isAdmin,
    }));
  } catch (err) {
    sendInternalError(res, err, 'Get project error:');
  }
});

router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);

    respondProject(res, await createProject({
      principal: principalFromRequest(req),
      workspaceId,
      userId,
      data: parsed.data,
    }));
  } catch (err) {
    sendInternalError(res, err, 'Create project error:');
  }
});

router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = guardProjectId(res, req.params.id);
    if (!id) return;
    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    respondProject(res, await updateProject({
      principal: principalFromRequest(req),
      projectId: id,
      workspaceId,
      userId,
      isAdmin,
      data: parsed.data,
    }));
  } catch (err) {
    sendInternalError(res, err, 'Update project error:');
  }
});

router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = guardProjectId(res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    respondProject(res, await deleteProject({
      principal: principalFromRequest(req),
      projectId: id,
      workspaceId,
      userId,
      isAdmin,
    }));
  } catch (err) {
    sendInternalError(res, err, 'Delete project error:');
  }
});

router.get('/:id/retro', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await guardProjectRead(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    respondRetro(res, await getProjectRetro({
      projectId: id,
      workspaceId,
      userId,
      isAdmin,
    }));
  } catch (err) {
    sendInternalError(res, err, 'Get project retro error:');
  }
});

router.post('/:id/retro', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = projectRetroSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const id = guardProjectId(res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    respondRetro(res, await createProjectRetro({
      principal: principalFromRequest(req),
      projectId: id,
      workspaceId,
      userId,
      isAdmin,
      data: parsed.data,
    }));
  } catch (err) {
    sendInternalError(res, err, 'Create project retro error:');
  }
});

router.patch('/:id/retro', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = projectRetroSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const id = guardProjectId(res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    respondRetro(res, await updateProjectRetro({
      principal: principalFromRequest(req),
      projectId: id,
      workspaceId,
      userId,
      isAdmin,
      data: parsed.data,
    }));
  } catch (err) {
    sendInternalError(res, err, 'Update project retro error:');
  }
});

router.get('/:id/issues', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await guardProjectRead(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    respondNested(res, await listProjectIssues({
      projectId: id,
      workspaceId,
      userId,
      isAdmin,
    }));
  } catch (err) {
    sendInternalError(res, err, 'Get project issues error:');
  }
});

router.get('/:id/weeks', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await guardProjectRead(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    respondNested(res, await listProjectSprints({
      projectId: id,
      workspaceId,
      userId,
      isAdmin,
    }));
  } catch (err) {
    sendInternalError(res, err, 'Get project weeks error:');
  }
});

router.get('/:id/sprints', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = await guardProjectRead(req, res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    respondNested(res, await listProjectSprints({
      projectId: id,
      workspaceId,
      userId,
      isAdmin,
    }));
  } catch (err) {
    sendInternalError(res, err, 'Get project sprints error:');
  }
});

router.post('/:id/sprints', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = createProjectSprintSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const id = guardProjectId(res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    respondNested(res, await createProjectSprint({
      principal: principalFromRequest(req),
      projectId: id,
      workspaceId,
      userId,
      isAdmin,
      data: parsed.data,
    }));
  } catch (err) {
    sendInternalError(res, err, 'Create project sprint error:');
  }
});

router.post('/:id/approve-plan', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = guardProjectId(res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    respondProject(res, await approveProjectPlan({
      principal: principalFromRequest(req),
      projectId: id,
      workspaceId,
      userId,
      isAdmin,
    }));
  } catch (err) {
    sendInternalError(res, err, 'Approve project plan error:');
  }
});

router.post('/:id/approve-retro', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = guardProjectId(res, req.params.id);
    if (!id) return;
    const { userId, workspaceId } = getAuthenticatedRouteContext(req);
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    respondProject(res, await approveProjectRetro({
      principal: principalFromRequest(req),
      projectId: id,
      workspaceId,
      userId,
      isAdmin,
    }));
  } catch (err) {
    sendInternalError(res, err, 'Approve project retro error:');
  }
});

export default router;
