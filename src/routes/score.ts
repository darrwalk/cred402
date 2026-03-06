import { Router, Request, Response } from 'express';
import { isAddress, getAddress } from 'viem';
import { getAgentScore } from '../services/scorer';
import { freeTierRateLimit } from '../middleware/rateLimit';
import { x402PaymentMiddleware } from '../middleware/x402';
import { config } from '../config';

const router = Router();

/**
 * GET /v1/score/:agent
 * Returns full v2 score breakdown with buckets, improvement tips, badges, weekly change.
 */
router.get(
  '/:agent',
  freeTierRateLimit(),
  x402PaymentMiddleware(config.scorePrice),
  async (req: Request, res: Response): Promise<void> => {
    const agent = req.params.agent as string;

    if (!isAddress(agent)) {
      res.status(400).json({ error: 'Invalid Ethereum address' });
      return;
    }

    try {
      const address = getAddress(agent);
      const result = await getAgentScore(address);

      res.json({
        agent: result.agent,
        score: result.score,
        grade: result.grade,
        label: result.label,
        unscored: result.unscored,
        scoredAt: result.scoredAt,
        freshness: result.freshness,
        weeklyChange: result.weeklyChange,
        buckets: result.buckets,
        badges: result.badges,
        improvementTips: result.improvementTips,
      });
    } catch (err) {
      console.error('Score error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
