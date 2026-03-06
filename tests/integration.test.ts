import { describe, it, expect } from 'vitest';
import {
  computeScore,
  type ScoreFactors,
} from '../src/scoring/engine';

describe('Integration: Score Claudia wallet', () => {
  const CLAUDIA_ADDRESS = '0xD6Ae8D2F816EE123E77D1D698f8a3873A563CB5F';

  it('computes a score for simulated Claudia data (v2)', () => {
    // Simulate Claudia's on-chain signals:
    // - 60 days old, active 6 of last 12 weeks
    // - $2,340 volume across 15 txs with 8 counterparties
    // - Endpoint reachable with x402 header
    // - No attestations yet
    const factors: ScoreFactors = {
      longevity: { daysSinceMint: 60, activeWeeksLast12: 6 },
      activity: {
        totalVolumeUsdc: 2340,
        transactions: Array.from({ length: 15 }, (_, i) => ({
          amountUsdc: 156,
          daysAgo: i * 4, // spread over ~60 days
          counterparty: `0x${((i % 8) + 1).toString(16).padStart(40, '0')}`,
        })),
        counterparties: Array.from({ length: 8 }, (_, i) => ({
          address: `0x${(i + 1).toString(16).padStart(40, '0')}`,
          txCount: i < 7 ? 2 : 1,
          trustScore: 45 + i * 5, // 45-80 range
        })),
      },
      reliability: {
        noEndpoint: false,
        successfulProbes30d: 700,
        totalProbes30d: 720,
        validX402Header: true,
        avgResponseMs: 300,
      },
      attestation: { humanVerified: false, peerAttestorCount: 0 },
    };

    const result = computeScore(factors);

    // Should be in C-B range — established but not yet fully mature
    expect(result.score).toBeGreaterThan(40);
    expect(result.score).toBeLessThan(80);
    expect(result.unscored).toBe(false);
    expect(['C', 'D', 'B']).toContain(result.grade);
    expect(result.buckets.longevity.score).toBeGreaterThan(0);
    expect(result.buckets.activity.score).toBeGreaterThan(0);
    expect(result.buckets.reliability.score).toBeGreaterThan(80);
    expect(result.improvementTips.length).toBeGreaterThan(0);
  });

  it('handles a fresh agent address with no on-chain presence', () => {
    const factors: ScoreFactors = {
      longevity: { daysSinceMint: 0, activeWeeksLast12: 0 },
      activity: { totalVolumeUsdc: 0, transactions: [], counterparties: [] },
      reliability: { noEndpoint: true, successfulProbes30d: 0, totalProbes30d: 0, validX402Header: false, avgResponseMs: 0 },
      attestation: { humanVerified: false, peerAttestorCount: 0 },
    };

    const result = computeScore(factors);

    // Brand new agent with nothing → Unscored (U)
    expect(result.grade).toBe('U');
    expect(result.unscored).toBe(true);
    expect(result.score).toBeLessThan(15);
  });
});
