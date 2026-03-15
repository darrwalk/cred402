import { Router, Request, Response } from 'express';
import { isAddress, getAddress } from 'viem';
import { getAgentScore } from '../services/scorer';

const router = Router();

/**
 * GET /v1/profile/:agent
 * Same as /v1/score/:agent (both return full breakdown).
 * Kept for backward compatibility.
 * Accepts Ethereum addresses and chain:id format.
 */
router.get(
  '/:agent',
  async (req: Request, res: Response): Promise<void> => {
    const rawAgent = req.params.agent as string;

    // Support chain:address format
    let agent = rawAgent;
    const colonIdx = rawAgent.indexOf(':');
    if (colonIdx > 0) {
      agent = rawAgent.slice(colonIdx + 1);
    }

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
