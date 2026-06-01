import { Router } from 'express';
import membersRouter from './members.js';
import invitesRouter from './invites.js';

const router = Router();
router.use(membersRouter);
router.use(invitesRouter);
export default router;
