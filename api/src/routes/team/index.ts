import { Router } from 'express';
import gridRouter from './grid.js';
import assignmentsRouter from './assignments.js';
import peopleRouter from './people.js';
import accountabilityRouter from './accountability.js';
import accountabilityGridV3Router from './accountability-grid-v3.js';
import reviewsRouter from './reviews.js';

const router = Router();

router.use(gridRouter);
router.use(assignmentsRouter);
router.use(peopleRouter);
router.use(accountabilityRouter);
router.use(accountabilityGridV3Router);
router.use(reviewsRouter);

export default router;
