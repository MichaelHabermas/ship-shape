/**
 * AI analysis routes for plan and retro quality feedback.
 *
 * POST /api/ai/analyze-plan - Analyze plan quality (falsifiability + workload)
 * POST /api/ai/analyze-retro - Analyze retro quality (plan coverage + evidence)
 * GET /api/ai/status - Check if AI analysis is available
 */

import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { analyzePlan, analyzeRetro, isAiAvailable, checkRateLimit } from '../services/ai-analysis.js';
import { getAuthenticatedRouteContext } from '../utils/auth-context.js';
import { sendLegacyError } from '../utils/route-http.js';

const router = Router();

function aiStatusPayload(available: boolean) {
  return available
    ? { available: true as const }
    : { available: false as const, error: 'ai_unavailable' as const };
}

// GET /api/ai/status - Check if AI analysis is available
router.get('/status', authMiddleware, async (_req: Request, res: Response) => {
  const available = await isAiAvailable();
  res.json(aiStatusPayload(available));
});

// POST /api/ai/analyze-plan - Analyze weekly plan quality
router.post('/analyze-plan', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuthenticatedRouteContext(req);
    const { content } = req.body;

    if (!content) {
      sendLegacyError(res, 400, 'content is required');
      return;
    }

    // Rate limit check
    if (!checkRateLimit(userId)) {
      res.status(429).json({ error: 'Rate limit exceeded. Max 10 analysis requests per hour.' });
      return;
    }

    const result = await analyzePlan(content);
    res.json(result);
  } catch (err) {
    console.error('Analyze plan error:', err);
    res.json({ error: 'ai_unavailable' });
  }
});

// POST /api/ai/analyze-retro - Analyze weekly retro quality
router.post('/analyze-retro', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId } = getAuthenticatedRouteContext(req);
    const { retro_content, plan_content } = req.body;

    if (!retro_content) {
      sendLegacyError(res, 400, 'retro_content is required');
      return;
    }

    if (!plan_content) {
      sendLegacyError(res, 400, 'plan_content is required');
      return;
    }

    // Rate limit check
    if (!checkRateLimit(userId)) {
      res.status(429).json({ error: 'Rate limit exceeded. Max 10 analysis requests per hour.' });
      return;
    }

    const result = await analyzeRetro(retro_content, plan_content);
    res.json(result);
  } catch (err) {
    console.error('Analyze retro error:', err);
    res.json({ error: 'ai_unavailable' });
  }
});

export default router;
