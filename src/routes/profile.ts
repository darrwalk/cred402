import { Router, Request, Response } from 'express';
import { isAddress, getAddress } from 'viem';
import { getAgentScore } from '../services/scorer';
import { freeTierRateLimit } from '../middleware/rateLimit';
import { x402PaymentMiddleware } from '../middleware/x402';
import { config } from '../config';

const router = Router();

/**
 * GET /v1/profile/:agent
 * Same as /v1/score/:agent in v2 (both return full breakdown).
 * Kept for backward compatibility.
 */
router.get(
  '/:agent',
  freeTierRateLimit(),
  x402PaymentMiddleware(config.profilePrice),
  async (req: Request, res: Response): Promise<void> => {
    const agent = req.params.agent as string;

    if (!isAddress(agent)) {
      res.status(400).json({ error: 'Invalid Ethereum address' });
      return;
    }

    try {
      const address = getAddress(agent);
      const result = await getAgentScore(address);
      res.json(result);
    } catch (err) {
      console.error('Profile error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
