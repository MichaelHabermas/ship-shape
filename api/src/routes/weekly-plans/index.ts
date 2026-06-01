import { Router } from 'express';
import allocationRouter from './allocation.js';
import plansRouter from './plans.js';
import { weeklyRetrosRouter } from './retros.js';

const router = Router();

router.use(allocationRouter);
router.use(plansRouter);

export { weeklyRetrosRouter };
export default router;
