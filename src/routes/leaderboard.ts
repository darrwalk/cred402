import { Router, Request, Response } from 'express';
import { getLeaderboard } from '../services/scorer';
import { freeTierRateLimit } from '../middleware/rateLimit';

const router = Router();

/**
 * GET /v1/leaderboard?limit=100&category=
 * Returns top agents sorted by score.
 * Categories: data, inference, defi, compute, social
 */
router.get(
  '/',
  freeTierRateLimit(),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const category = (req.query.category as string) || undefined;

      const entries = await getLeaderboard(limit, category);

      res.json({
        leaderboard: entries,
        total: entries.length,
        category: category || 'all',
        updatedAt: Math.floor(Date.now() / 1000),
      });
    } catch (err) {
      console.error('Leaderboard error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
