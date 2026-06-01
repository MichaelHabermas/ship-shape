import { Router } from 'express';
import currentRouter from './current.js';
import membersRouter from './members.js';
import invitesRouter from './invites.js';
import auditLogsRouter from './audit-logs.js';

const router = Router();

router.use(currentRouter);
router.use(membersRouter);
router.use(invitesRouter);
router.use(auditLogsRouter);

export default router;
