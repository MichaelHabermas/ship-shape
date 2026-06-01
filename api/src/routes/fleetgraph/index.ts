import { Router, type Router as ExpressRouter } from 'express';
import findingsRouter from './findings.js';
import chatRouter from './chat.js';
import reviewerRouter from './reviewer.js';
import testRoutesRouter from './test-routes.js';

const router: ExpressRouter = Router();

router.use(findingsRouter);
router.use(chatRouter);
router.use(reviewerRouter);
router.use(testRoutesRouter);

export default router;
