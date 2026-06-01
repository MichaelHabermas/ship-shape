import { Router } from 'express';
import listRouter from './list.js';
import crudRouter from './crud.js';
import contentRouter from './content.js';
import commandsRouter from './commands.js';

const router = Router();

router.use(listRouter);
router.use(crudRouter);
router.use(contentRouter);
router.use(commandsRouter);

export default router;
