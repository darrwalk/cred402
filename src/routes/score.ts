import { Router, Request, Response } from 'express';
import { isAddress, getAddress } from 'viem';
import { getAgentScore } from '../services/scorer';

const router = Router();

/**
 * Parse agent identifier — supports both raw Ethereum addresses and chain:id format.
 * Examples:
 *   "0xD6Ae8D2F816EE123E77D1D698f8a3873A563CB5F" → { chain: undefined, address: "0xD6..." }
 *   "base:0xD6Ae..." → { chain: "base", address: "0xD6..." }
 *   "base:1234" → { chain: "base", id: "1234" } (ERC-8004 numeric agent ID)
 */
function parseAgentParam(raw: string): { address?: `0x${string}`; chain?: string; id?: string; error?: string } {
  // Check for chain:value format
  const colonIdx = raw.indexOf(':');
  if (colonIdx > 0) {
    const chain = raw.slice(0, colonIdx).toLowerCase();
    const value = raw.slice(colonIdx + 1);

    // If value is an address
    if (isAddress(value)) {
      return { chain, address: getAddress(value) };
    }

    // If value is numeric (ERC-8004 agent ID)
    if (/^\d+$/.test(value)) {
      return { chain, id: value };
    }

    return { error: `Invalid agent identifier after chain prefix: ${value}` };
  }

  // Raw Ethereum address
  if (isAddress(raw)) {
    return { address: getAddress(raw) };
  }

  return { error: `Invalid agent identifier: ${raw}. Use an Ethereum address or chain:address format.` };
}

/**
 * GET /v1/score/:agent
 * Returns full v2 score breakdown with buckets, improvement tips, badges, weekly change.
 * Accepts Ethereum addresses and chain:id format (e.g., base:0xABC... or base:1234).
 */
router.get(
  '/:agent',
  async (req: Request, res: Response): Promise<void> => {
    const rawAgent = req.params.agent as string;
    const parsed = parseAgentParam(rawAgent);

    if (parsed.error) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    // For now, only address-based lookups are supported.
    // chain:numericId will need ERC-8004 registry resolution in the future.
    if (parsed.id && !parsed.address) {
      res.status(501).json({
        error: 'Numeric agent ID resolution not yet implemented. Use chain:address format.',
        chain: parsed.chain,
        id: parsed.id,
      });
      return;
    }

    try {
      const result = await getAgentScore(parsed.address!);

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
