import { Router } from 'express';
import myWorkRouter from './my-work.js';
import myFocusRouter from './my-focus.js';
import myWeekRouter from './my-week.js';

const router = Router();
router.use(myWorkRouter);
router.use(myFocusRouter);
router.use(myWeekRouter);
export default router;
