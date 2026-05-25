import { Router } from 'express';
import { authMiddleware, superAdminMiddleware } from '../../middleware/auth.js';
import workspacesRouter from './workspaces.js';
import usersRouter from './users.js';
import auditLogsRouter from './audit-logs.js';
import impersonateRouter from './impersonate.js';
import workspaceMembersRouter from './workspace-members.js';
import debugRouter from './debug.js';

const router = Router();

router.use(authMiddleware, superAdminMiddleware);
router.use(workspacesRouter);
router.use(usersRouter);
router.use(auditLogsRouter);
router.use(impersonateRouter);
router.use(workspaceMembersRouter);
router.use(debugRouter);

export default router;
