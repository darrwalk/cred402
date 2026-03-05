import { describe, it, expect } from 'vitest';
import {
  computeScore,
  type ScoreFactors,
} from '../src/scoring/engine';

describe('Integration: Score Claudia wallet', () => {
  const CLAUDIA_ADDRESS = '0xD6Ae8D2F816EE123E77D1D698f8a3873A563CB5F';

  it('computes a score for simulated Claudia data', () => {
    // Simulate Claudia's on-chain signals:
    // - Has ERC-8004 registration
    // - 60 days old
    // - 15 USDC transactions, 95% success rate
    // - Endpoint reachable
    // - No attestations (MVP stub)
    const factors: ScoreFactors = {
      identity: { hasERC8004: true, daysSinceFirst: 60 },
      payments: { txCount: 15, successRate: 0.95 },
      reliability: { endpointReachable: true, noEndpoint: false },
      attestations: {},
    };

    const result = computeScore(factors);

    // identity: 80 * 0.25 = 20
    // payments: (15/20*60=45) + (0.95*40=38) = 83 * 0.40 = 33.2
    // reliability: 80 * 0.20 = 16
    // attestations: 0 * 0.15 = 0
    // total = round(69.2) = 69
    expect(result.score).toBe(69);
    expect(result.grade).toBe('C');
    expect(result.label).toBe('Fair');
    expect(result.factors.identity.score).toBe(80);
    expect(result.factors.payments.score).toBe(83);
    expect(result.factors.reliability.score).toBe(80);
    expect(result.factors.attestations.score).toBe(0);
  });

  it('handles a fresh agent address with no on-chain presence', () => {
    const factors: ScoreFactors = {
      identity: { hasERC8004: false, daysSinceFirst: 0 },
      payments: { txCount: 0, successRate: 0 },
      reliability: { endpointReachable: false, noEndpoint: true },
      attestations: {},
    };

    const result = computeScore(factors);

    expect(result.score).toBe(15);
    expect(result.grade).toBe('F');
    expect(result.label).toBe('High Risk');
  });
});
