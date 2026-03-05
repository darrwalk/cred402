import { describe, it, expect } from 'vitest';
import {
  computeScore,
  computeIdentityScore,
  computePaymentScore,
  computeReliabilityScore,
  computeAttestationScore,
  type ScoreFactors,
} from '../src/scoring/engine';
import { getGrade, getUnscored } from '../src/scoring/grades';

describe('Score Formula', () => {
  describe('computeIdentityScore', () => {
    it('returns 50 base for ERC-8004 registered agent', () => {
      expect(computeIdentityScore({ hasERC8004: true, daysSinceFirst: 0 })).toBe(50);
    });

    it('returns 20 base for non-ERC-8004 agent', () => {
      expect(computeIdentityScore({ hasERC8004: false, daysSinceFirst: 0 })).toBe(20);
    });

    it('adds up to 30 for age (capped at 30 days)', () => {
      expect(computeIdentityScore({ hasERC8004: true, daysSinceFirst: 30 })).toBe(80);
      expect(computeIdentityScore({ hasERC8004: true, daysSinceFirst: 60 })).toBe(80);
    });

    it('adds partial age points', () => {
      expect(computeIdentityScore({ hasERC8004: true, daysSinceFirst: 15 })).toBe(65);
    });

    it('non-registered with max age', () => {
      expect(computeIdentityScore({ hasERC8004: false, daysSinceFirst: 30 })).toBe(50);
    });
  });

  describe('computePaymentScore', () => {
    it('returns 0 for no transactions', () => {
      expect(computePaymentScore({ txCount: 0, successRate: 0 })).toBe(0);
    });

    it('returns 100 for max transactions with perfect success rate', () => {
      expect(computePaymentScore({ txCount: 20, successRate: 1 })).toBe(100);
    });

    it('caps tx count at 20', () => {
      expect(computePaymentScore({ txCount: 100, successRate: 1 })).toBe(100);
    });

    it('partial tx count and success rate', () => {
      // 10/20 * 60 = 30 + 0.5 * 40 = 20 = 50
      expect(computePaymentScore({ txCount: 10, successRate: 0.5 })).toBe(50);
    });
  });

  describe('computeReliabilityScore', () => {
    it('returns 80 when endpoint is reachable', () => {
      expect(computeReliabilityScore({ endpointReachable: true, noEndpoint: false })).toBe(80);
    });

    it('returns 50 when no endpoint is set', () => {
      expect(computeReliabilityScore({ endpointReachable: false, noEndpoint: true })).toBe(50);
    });

    it('returns 0 when endpoint is set but unreachable', () => {
      expect(computeReliabilityScore({ endpointReachable: false, noEndpoint: false })).toBe(0);
    });
  });

  describe('computeAttestationScore', () => {
    it('returns 0 (MVP stub)', () => {
      expect(computeAttestationScore({})).toBe(0);
    });
  });

  describe('computeScore (composite)', () => {
    it('computes correct final score for a well-established agent', () => {
      const factors: ScoreFactors = {
        identity: { hasERC8004: true, daysSinceFirst: 30 },
        payments: { txCount: 20, successRate: 1 },
        reliability: { endpointReachable: true, noEndpoint: false },
        attestations: {},
      };

      const result = computeScore(factors);

      // identity: 80 * 0.25 = 20
      // payments: 100 * 0.40 = 40
      // reliability: 80 * 0.20 = 16
      // attestations: 0 * 0.15 = 0
      // total = 76
      expect(result.score).toBe(76);
      expect(result.grade).toBe('B');
      expect(result.label).toBe('Good');
    });

    it('computes correct score for a new agent with no history', () => {
      const factors: ScoreFactors = {
        identity: { hasERC8004: false, daysSinceFirst: 0 },
        payments: { txCount: 0, successRate: 0 },
        reliability: { endpointReachable: false, noEndpoint: true },
        attestations: {},
      };

      const result = computeScore(factors);

      // identity: 20 * 0.25 = 5
      // payments: 0 * 0.40 = 0
      // reliability: 50 * 0.20 = 10
      // attestations: 0 * 0.15 = 0
      // total = 15
      expect(result.score).toBe(15);
      expect(result.grade).toBe('F');
      expect(result.label).toBe('High Risk');
    });

    it('computes mid-range score', () => {
      const factors: ScoreFactors = {
        identity: { hasERC8004: true, daysSinceFirst: 15 },
        payments: { txCount: 10, successRate: 0.8 },
        reliability: { endpointReachable: false, noEndpoint: true },
        attestations: {},
      };

      const result = computeScore(factors);

      // identity: 65 * 0.25 = 16.25
      // payments: (30 + 32) = 62 * 0.40 = 24.8
      // reliability: 50 * 0.20 = 10
      // attestations: 0 * 0.15 = 0
      // total = round(51.05) = 51
      expect(result.score).toBe(51);
      expect(result.grade).toBe('D');
    });
  });
});

describe('Grade Mapping', () => {
  it('maps scores to correct grades', () => {
    expect(getGrade(95).grade).toBe('A');
    expect(getGrade(90).grade).toBe('A');
    expect(getGrade(89).grade).toBe('B');
    expect(getGrade(75).grade).toBe('B');
    expect(getGrade(74).grade).toBe('C');
    expect(getGrade(55).grade).toBe('C');
    expect(getGrade(54).grade).toBe('D');
    expect(getGrade(35).grade).toBe('D');
    expect(getGrade(34).grade).toBe('F');
    expect(getGrade(0).grade).toBe('F');
  });

  it('maps labels correctly', () => {
    expect(getGrade(95).label).toBe('Excellent');
    expect(getGrade(80).label).toBe('Good');
    expect(getGrade(60).label).toBe('Fair');
    expect(getGrade(40).label).toBe('Poor');
    expect(getGrade(10).label).toBe('High Risk');
  });

  it('returns Unscored for U grade', () => {
    expect(getUnscored().grade).toBe('U');
    expect(getUnscored().label).toBe('Unscored');
  });
});
