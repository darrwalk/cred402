import { describe, it, expect } from 'vitest';
import {
  computeScore,
  computeLongevity,
  computeActivity,
  computeReliability,
  computeAttestation,
  computeRecency,
  computeDiversity,
  computeCounterpartyQuality,
  type ScoreFactors,
  type TransactionInfo,
  type CounterpartyInfo,
  type LongevityFactors,
  type ActivityFactors,
  type ReliabilityFactors,
  type AttestationFactors,
} from '../src/scoring/engine';
import { getGrade, getUnscored } from '../src/scoring/grades';

// ──────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────

function makeTxs(count: number, opts: Partial<TransactionInfo> = {}): TransactionInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    amountUsdc: opts.amountUsdc ?? 10,
    daysAgo: opts.daysAgo ?? 5,
    counterparty: opts.counterparty ?? `0x${(i + 1).toString(16).padStart(40, '0')}`,
  }));
}

function makeCps(count: number, txCountEach: number = 1, trustScore: number | null = null): CounterpartyInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    address: `0x${(i + 1).toString(16).padStart(40, '0')}`,
    txCount: txCountEach,
    trustScore,
  }));
}

function makeFactors(overrides: Partial<ScoreFactors> = {}): ScoreFactors {
  return {
    longevity: overrides.longevity ?? { daysSinceMint: 180, activeWeeksLast12: 8 },
    activity: overrides.activity ?? {
      totalVolumeUsdc: 5000,
      transactions: makeTxs(20),
      counterparties: makeCps(20, 1, 60),
    },
    reliability: overrides.reliability ?? {
      noEndpoint: false,
      successfulProbes30d: 700,
      totalProbes30d: 720,
      validX402Header: true,
      avgResponseMs: 200,
    },
    attestation: overrides.attestation ?? {
      humanVerified: false,
      peerAttestorCount: 2,
    },
  };
}

// ──────────────────────────────────────────────────
// Longevity Bucket
// ──────────────────────────────────────────────────

describe('Longevity', () => {
  it('brand new agent scores near 0', () => {
    const result = computeLongevity({ daysSinceMint: 0, activeWeeksLast12: 0 });
    expect(result.score).toBeCloseTo(0, 0);
  });

  it('6-month-old consistent agent scores in 60-80 range', () => {
    const result = computeLongevity({ daysSinceMint: 180, activeWeeksLast12: 8 });
    // log(181)/log(731) = 0.787, consistency = 8/12 = 0.667
    // (0.787*0.6 + 0.667*0.4) * 100 ≈ 74
    expect(result.score).toBeGreaterThan(60);
    expect(result.score).toBeLessThan(80);
  });

  it('2-year-old fully consistent agent scores ~100', () => {
    const result = computeLongevity({ daysSinceMint: 730, activeWeeksLast12: 12 });
    expect(result.score).toBeGreaterThanOrEqual(95);
  });

  it('old but inconsistent agent is penalized', () => {
    const consistent = computeLongevity({ daysSinceMint: 365, activeWeeksLast12: 12 });
    const inconsistent = computeLongevity({ daysSinceMint: 365, activeWeeksLast12: 2 });
    expect(consistent.score).toBeGreaterThan(inconsistent.score + 15);
  });

  it('weight is 0.20', () => {
    const result = computeLongevity({ daysSinceMint: 30, activeWeeksLast12: 4 });
    expect(result.weight).toBe(0.20);
  });
});

// ──────────────────────────────────────────────────
// Activity Bucket
// ──────────────────────────────────────────────────

describe('Activity', () => {
  it('no transactions scores very low', () => {
    const result = computeActivity({
      totalVolumeUsdc: 0,
      transactions: [],
      counterparties: [],
    });
    // cpQuality defaults to 0.3, so: 0*0.25 + 0*0.25 + 0*0.30 + 0.3*0.20 = 0.06 → 6
    expect(result.score).toBeLessThan(10);
  });

  it('healthy activity scores 50-90', () => {
    const txs = makeTxs(30, { daysAgo: 15 });
    const cps = makeCps(15, 2, 65);
    const result = computeActivity({
      totalVolumeUsdc: 5000,
      transactions: txs,
      counterparties: cps,
    });
    expect(result.score).toBeGreaterThan(50);
    expect(result.score).toBeLessThan(90);
  });

  it('weight is 0.45', () => {
    const result = computeActivity({
      totalVolumeUsdc: 100,
      transactions: makeTxs(5),
      counterparties: makeCps(5),
    });
    expect(result.weight).toBe(0.45);
  });
});

describe('Recency', () => {
  it('all recent txs = 1.0', () => {
    const txs = makeTxs(10, { daysAgo: 5 });
    expect(computeRecency(txs)).toBe(1.0);
  });

  it('all old txs → ~0.15', () => {
    const txs = makeTxs(10, { daysAgo: 365 });
    expect(computeRecency(txs)).toBeCloseTo(0.15, 4);
  });

  it('mixed recency averages correctly', () => {
    const txs = [
      { amountUsdc: 10, daysAgo: 10, counterparty: '0x01' },  // 1.0
      { amountUsdc: 10, daysAgo: 60, counterparty: '0x02' },  // 0.7
      { amountUsdc: 10, daysAgo: 120, counterparty: '0x03' }, // 0.4
      { amountUsdc: 10, daysAgo: 200, counterparty: '0x04' }, // 0.15
    ];
    const expected = (1.0 + 0.7 + 0.4 + 0.15) / 4;
    expect(computeRecency(txs)).toBeCloseTo(expected, 4);
  });

  it('no txs = 0', () => {
    expect(computeRecency([])).toBe(0);
  });
});

// ──────────────────────────────────────────────────
// Anti-Wash-Trading: Diversity
// ──────────────────────────────────────────────────

describe('Diversity (anti-wash-trading)', () => {
  it('wash trading: 100 txs with 1 address → diversity ≈ 0', () => {
    const txs = makeTxs(100, { counterparty: '0xWASH' });
    const cps: CounterpartyInfo[] = [{ address: '0xWASH', txCount: 100, trustScore: null }];
    const diversity = computeDiversity(txs, cps);
    // 1 - (100/100) + min(1/50, 1)*0.2 = 0 + 0.004 = 0.004
    expect(diversity).toBeLessThan(0.05);
  });

  it('well-distributed: 50 counterparties → high diversity', () => {
    const txs = makeTxs(50); // each has unique counterparty
    const cps = makeCps(50, 1);
    const diversity = computeDiversity(txs, cps);
    // 1 - (1/50) + min(50/50, 1)*0.2 = 0.98 + 0.2 = 1.18 → capped at 1.0
    expect(diversity).toBeGreaterThanOrEqual(0.95);
  });

  it('moderate concentration penalized', () => {
    // 10 txs, but 8 with one address
    const txs = [
      ...makeTxs(8, { counterparty: '0xDOMINANT' }),
      ...makeTxs(1, { counterparty: '0xOTHER1' }),
      ...makeTxs(1, { counterparty: '0xOTHER2' }),
    ];
    const cps: CounterpartyInfo[] = [
      { address: '0xDOMINANT', txCount: 8, trustScore: null },
      { address: '0xOTHER1', txCount: 1, trustScore: null },
      { address: '0xOTHER2', txCount: 1, trustScore: null },
    ];
    const diversity = computeDiversity(txs, cps);
    // 1 - 0.8 + min(3/50,1)*0.2 = 0.2 + 0.012 = 0.212
    expect(diversity).toBeLessThan(0.25);
  });
});

// ──────────────────────────────────────────────────
// Counterparty Quality
// ──────────────────────────────────────────────────

describe('Counterparty Quality', () => {
  it('defaults to 0.3 when no scored counterparties', () => {
    const cps = makeCps(5, 1, null);
    expect(computeCounterpartyQuality(cps)).toBe(0.3);
  });

  it('excludes counterparties with score ≤ 20', () => {
    const cps: CounterpartyInfo[] = [
      { address: '0x01', txCount: 5, trustScore: 15 },
      { address: '0x02', txCount: 5, trustScore: 10 },
    ];
    expect(computeCounterpartyQuality(cps)).toBe(0.3); // all excluded → default
  });

  it('weighted average of qualified counterparties', () => {
    const cps: CounterpartyInfo[] = [
      { address: '0x01', txCount: 3, trustScore: 80 },
      { address: '0x02', txCount: 1, trustScore: 40 },
    ];
    // weighted: (80*3/4 + 40*1/4) / 100 = (60 + 10) / 100 = 0.7
    expect(computeCounterpartyQuality(cps)).toBeCloseTo(0.7, 2);
  });

  it('high-quality counterparties → high score', () => {
    const cps = makeCps(10, 2, 90);
    expect(computeCounterpartyQuality(cps)).toBeCloseTo(0.9, 2);
  });
});

// ──────────────────────────────────────────────────
// Reliability Bucket
// ──────────────────────────────────────────────────

describe('Reliability', () => {
  it('no endpoint = 50', () => {
    const result = computeReliability({
      noEndpoint: true,
      successfulProbes30d: 0,
      totalProbes30d: 0,
      validX402Header: false,
      avgResponseMs: 0,
    });
    expect(result.score).toBe(50);
  });

  it('perfect uptime + x402 + fast response = 100', () => {
    const result = computeReliability({
      noEndpoint: false,
      successfulProbes30d: 720,
      totalProbes30d: 720,
      validX402Header: true,
      avgResponseMs: 50,
    });
    expect(result.score).toBeGreaterThan(95);
  });

  it('endpoint down = low score', () => {
    const result = computeReliability({
      noEndpoint: false,
      successfulProbes30d: 100,
      totalProbes30d: 720,
      validX402Header: false,
      avgResponseMs: 3000,
    });
    expect(result.score).toBeLessThan(20);
  });

  it('weight is 0.20', () => {
    const result = computeReliability({
      noEndpoint: true,
      successfulProbes30d: 0,
      totalProbes30d: 0,
      validX402Header: false,
      avgResponseMs: 0,
    });
    expect(result.weight).toBe(0.20);
  });
});

// ──────────────────────────────────────────────────
// Attestation Bucket
// ──────────────────────────────────────────────────

describe('Attestation', () => {
  it('no attestations = 0', () => {
    const result = computeAttestation({ humanVerified: false, peerAttestorCount: 0 });
    expect(result.score).toBe(0);
  });

  it('human verified = 30', () => {
    const result = computeAttestation({ humanVerified: true, peerAttestorCount: 0 });
    expect(result.score).toBe(30);
  });

  it('6 peer attestors = 30', () => {
    const result = computeAttestation({ humanVerified: false, peerAttestorCount: 6 });
    expect(result.score).toBe(30);
  });

  it('peer count capped at 6', () => {
    const result = computeAttestation({ humanVerified: false, peerAttestorCount: 20 });
    expect(result.score).toBe(30); // still capped at 6*5=30
  });

  it('human + 6 peers = 60', () => {
    const result = computeAttestation({ humanVerified: true, peerAttestorCount: 6 });
    expect(result.score).toBe(60);
  });

  it('capped at 100', () => {
    const result = computeAttestation({ humanVerified: true, peerAttestorCount: 20 });
    expect(result.score).toBe(60); // 30 + min(20,6)*5 = 30 + 30 = 60
  });

  it('weight is 0.15', () => {
    const result = computeAttestation({ humanVerified: false, peerAttestorCount: 0 });
    expect(result.weight).toBe(0.15);
  });
});

// ──────────────────────────────────────────────────
// Composite Score
// ──────────────────────────────────────────────────

describe('computeScore (composite)', () => {
  it('well-established agent scores in reasonable range', () => {
    const factors = makeFactors();
    const result = computeScore(factors);
    expect(result.score).toBeGreaterThan(40);
    expect(result.score).toBeLessThan(90);
    expect(result.unscored).toBe(false);
  });

  it('brand new agent with zero history → grade U (unscored)', () => {
    const factors = makeFactors({
      longevity: { daysSinceMint: 3, activeWeeksLast12: 0 },
      activity: { totalVolumeUsdc: 0, transactions: [], counterparties: [] },
      reliability: { noEndpoint: true, successfulProbes30d: 0, totalProbes30d: 0, validX402Header: false, avgResponseMs: 0 },
      attestation: { humanVerified: false, peerAttestorCount: 0 },
    });
    const result = computeScore(factors);
    expect(result.grade).toBe('U');
    expect(result.unscored).toBe(true);
  });

  it('new agent with <7 days and <5 txs → unscored', () => {
    const factors = makeFactors({
      longevity: { daysSinceMint: 5, activeWeeksLast12: 1 },
      activity: {
        totalVolumeUsdc: 100,
        transactions: makeTxs(3),
        counterparties: makeCps(3, 1, null),
      },
    });
    const result = computeScore(factors);
    expect(result.grade).toBe('U');
  });

  it('agent with 5+ txs but <7 days is NOT unscored', () => {
    const factors = makeFactors({
      longevity: { daysSinceMint: 3, activeWeeksLast12: 1 },
      activity: {
        totalVolumeUsdc: 1000,
        transactions: makeTxs(10),
        counterparties: makeCps(10, 1, 50),
      },
    });
    const result = computeScore(factors);
    expect(result.grade).not.toBe('U');
    expect(result.unscored).toBe(false);
  });

  it('agent with 7+ days but <5 txs is NOT unscored', () => {
    const factors = makeFactors({
      longevity: { daysSinceMint: 14, activeWeeksLast12: 2 },
      activity: {
        totalVolumeUsdc: 50,
        transactions: makeTxs(3),
        counterparties: makeCps(3, 1, null),
      },
    });
    const result = computeScore(factors);
    expect(result.grade).not.toBe('U');
    expect(result.unscored).toBe(false);
  });

  it('returns improvement tips', () => {
    const factors = makeFactors({
      attestation: { humanVerified: false, peerAttestorCount: 0 },
    });
    const result = computeScore(factors);
    expect(result.improvementTips.length).toBeGreaterThan(0);
  });

  it('returns badges for qualified agents', () => {
    const factors = makeFactors({
      longevity: { daysSinceMint: 400, activeWeeksLast12: 11 },
      activity: {
        totalVolumeUsdc: 15000,
        transactions: makeTxs(50, { daysAgo: 10 }),
        counterparties: makeCps(25, 2, 80),
      },
      reliability: {
        noEndpoint: false,
        successfulProbes30d: 720,
        totalProbes30d: 720,
        validX402Header: true,
        avgResponseMs: 100,
      },
      attestation: { humanVerified: true, peerAttestorCount: 4 },
    });
    const result = computeScore(factors);
    expect(result.badges).toContain('🎖️ Veteran');
    expect(result.badges).toContain('🕐 Consistent');
    expect(result.badges).toContain('🌐 Well-Connected');
    expect(result.badges).toContain('💎 High-Volume');
    expect(result.badges).toContain('📡 Endpoint Verified');
    expect(result.badges).toContain('✅ Human Verified');
  });
});

// ──────────────────────────────────────────────────
// Anti-Abuse Properties (Integration-level)
// ──────────────────────────────────────────────────

describe('Anti-Abuse Properties', () => {
  it('wash trading: 100 txs with 1 address → diversity ≈ 0 and massive activity penalty', () => {
    const singleCp = '0xWASHPARTNER';

    // Wash trader: high volume, single counterparty
    const washFactors = makeFactors({
      activity: {
        totalVolumeUsdc: 50000,
        transactions: makeTxs(100, { counterparty: singleCp, daysAgo: 5 }),
        counterparties: [{ address: singleCp, txCount: 100, trustScore: null }],
      },
    });

    // Legit agent: same volume, diverse counterparties
    const legitFactors = makeFactors({
      activity: {
        totalVolumeUsdc: 50000,
        transactions: makeTxs(100, { daysAgo: 5 }),
        counterparties: makeCps(100, 1, 60),
      },
    });

    const wash = computeScore(washFactors);
    const legit = computeScore(legitFactors);

    // Key property: diversity score collapses
    expect(wash.buckets.activity.details.diversityScore).toBeLessThan(0.05);

    // Key property: wash trader scores MUCH lower on activity than legit agent
    expect(legit.buckets.activity.score - wash.buckets.activity.score).toBeGreaterThan(25);

    // The wash trader's activity score is severely penalized (diversity × 0.30 weight → ~0)
    expect(wash.buckets.activity.score).toBeLessThan(legit.buckets.activity.score * 0.7);
  });

  it('sybil attestation: new agents cant boost each other', () => {
    // New agents have score ~0, so they can't count as peer attestors (need >70)
    const factors = makeFactors({
      attestation: { humanVerified: false, peerAttestorCount: 0 },  // no qualified peers
    });
    const result = computeScore(factors);
    expect(result.buckets.attestation.score).toBe(0);
  });

  it('burst activity: old txs decay via recency', () => {
    // Agent had 100 txs long ago, nothing recent
    const oldBurst = makeFactors({
      activity: {
        totalVolumeUsdc: 10000,
        transactions: makeTxs(100, { daysAgo: 300 }),
        counterparties: makeCps(100, 1, 50),
      },
    });

    // Agent has same volume but all recent
    const recentActive = makeFactors({
      activity: {
        totalVolumeUsdc: 10000,
        transactions: makeTxs(100, { daysAgo: 10 }),
        counterparties: makeCps(100, 1, 50),
      },
    });

    const old = computeScore(oldBurst);
    const recent = computeScore(recentActive);

    // Recency should be 0.15 (all >180 days old)
    expect(old.buckets.activity.details.recency).toBeCloseTo(0.15, 2);
    expect(recent.buckets.activity.details.recency).toBe(1.0);

    // Recent activity should score significantly higher
    expect(recent.buckets.activity.score - old.buckets.activity.score).toBeGreaterThan(15);
  });

  it('volume inflation: tiny txs worth less than real ones due to log scale', () => {
    // Many tiny txs
    const tinyFactors = makeFactors({
      activity: {
        totalVolumeUsdc: 10, // 10000 * $0.001
        transactions: makeTxs(100, { amountUsdc: 0.001, daysAgo: 5 }),
        counterparties: makeCps(50, 2, null),
      },
    });

    // Few real txs
    const realFactors = makeFactors({
      activity: {
        totalVolumeUsdc: 100, // 10 * $10
        transactions: makeTxs(10, { amountUsdc: 10, daysAgo: 5 }),
        counterparties: makeCps(10, 1, 50),
      },
    });

    const tiny = computeScore(tinyFactors);
    const real = computeScore(realFactors);

    // Real agent should score higher on volume
    expect(real.buckets.activity.details.logVolume).toBeGreaterThan(tiny.buckets.activity.details.logVolume);
  });
});

// ──────────────────────────────────────────────────
// Grade Mapping (v2 boundaries)
// ──────────────────────────────────────────────────

describe('Grade Mapping', () => {
  it('maps scores to correct grades', () => {
    expect(getGrade(95).grade).toBe('A');
    expect(getGrade(90).grade).toBe('A');
    expect(getGrade(89).grade).toBe('B');
    expect(getGrade(75).grade).toBe('B');
    expect(getGrade(74).grade).toBe('C');
    expect(getGrade(55).grade).toBe('C');
    expect(getGrade(54).grade).toBe('D');
    expect(getGrade(30).grade).toBe('D');
    expect(getGrade(29).grade).toBe('F');
    expect(getGrade(0).grade).toBe('F');
  });

  it('maps labels correctly', () => {
    expect(getGrade(95).label).toBe('Excellent');
    expect(getGrade(80).label).toBe('Good');
    expect(getGrade(60).label).toBe('Fair');
    expect(getGrade(40).label).toBe('Poor');
    expect(getGrade(10).label).toBe('Untrustworthy');
  });

  it('returns Unscored for U grade', () => {
    expect(getUnscored().grade).toBe('U');
    expect(getUnscored().label).toBe('Unscored');
  });
});
