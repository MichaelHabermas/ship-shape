import { Router } from 'express';
import myWeekRouter from './my-week.js';
import sprintsRouter from './sprints.js';
import nestedStandupsRouter from './nested-standups.js';
import reviewsRouter from './reviews.js';
import approvalsRouter from './approvals.js';

const router = Router();

// Static paths before /:id (my-week, lookup, collection)
router.use(myWeekRouter);
router.use(sprintsRouter);
router.use(nestedStandupsRouter);
router.use(reviewsRouter);
router.use(approvalsRouter);

export default router;
