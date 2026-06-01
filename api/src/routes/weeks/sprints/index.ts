import { Router } from 'express';
import lookupRouter from './lookup.js';
import collectionRouter from './collection.js';
import detailRouter from './detail.js';
import planRouter from './plan.js';
import issuesRouter from './issues.js';

const router = Router();

router.use(lookupRouter);
router.use(collectionRouter);
router.use(detailRouter);
router.use(planRouter);
router.use(issuesRouter);

export default router;
