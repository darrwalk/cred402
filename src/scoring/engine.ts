import { getGrade, getUnscored, type Grade, type GradeInfo } from './grades';

// ──────────────────────────────────────────────────
// Input types — all scoring functions are pure
// ──────────────────────────────────────────────────

export interface LongevityFactors {
  daysSinceMint: number;         // age of agent in days
  activeWeeksLast12: number;     // weeks (out of 12) with ≥1 tx
}

export interface TransactionInfo {
  amountUsdc: number;
  daysAgo: number;
  counterparty: string;
}

export interface CounterpartyInfo {
  address: string;
  txCount: number;
  trustScore: number | null;     // null = unscored
}

export interface ActivityFactors {
  totalVolumeUsdc: number;
  transactions: TransactionInfo[];
  counterparties: CounterpartyInfo[];
}

export interface ReliabilityFactors {
  noEndpoint: boolean;
  successfulProbes30d: number;
  totalProbes30d: number;
  validX402Header: boolean;
  avgResponseMs: number;
}

export interface AttestationFactors {
  humanVerified: boolean;
  peerAttestorCount: number;     // count of attestors with score > 70
}

export interface ScoreFactors {
  longevity: LongevityFactors;
  activity: ActivityFactors;
  reliability: ReliabilityFactors;
  attestation: AttestationFactors;
}

// ──────────────────────────────────────────────────
// Output types
// ──────────────────────────────────────────────────

export interface BucketBreakdown {
  score: number;
  weight: number;
  details: Record<string, number>;
}

export interface ScoreResult {
  score: number;
  grade: Grade;
  label: string;
  unscored: boolean;
  buckets: {
    longevity: BucketBreakdown;
    activity: BucketBreakdown;
    reliability: BucketBreakdown;
    attestation: BucketBreakdown;
  };
  improvementTips: string[];
  badges: string[];
}

// ──────────────────────────────────────────────────
// Bucket 1: Longevity (20%)
// ──────────────────────────────────────────────────

export function computeLongevity(f: LongevityFactors): BucketBreakdown {
  // age_score: log scale, 0→1 over 2 years (730 days)
  const ageScore = Math.log(f.daysSinceMint + 1) / Math.log(730 + 1);

  // consistency: active weeks out of 12
  const consistencyScore = Math.min(f.activeWeeksLast12, 12) / 12;

  const raw = (ageScore * 0.6 + consistencyScore * 0.4) * 100;
  const score = Math.min(Math.max(raw, 0), 100);

  return {
    score,
    weight: 0.20,
    details: {
      ageScore: round4(ageScore),
      consistencyScore: round4(consistencyScore),
    },
  };
}

// ──────────────────────────────────────────────────
// Bucket 2: Activity (45%) — anti-wash-trading
// ──────────────────────────────────────────────────

export function computeActivity(f: ActivityFactors): BucketBreakdown {
  // 2a. Volume (log scale, cap at $100K)
  const logVolume = Math.log10(f.totalVolumeUsdc + 1) / Math.log10(100000 + 1);

  // 2b. Recency decay
  const recency = computeRecency(f.transactions);

  // 2c. Diversity (anti-wash)
  const diversityResult = computeDiversity(f.transactions, f.counterparties);

  // 2d. Counterparty quality (PageRank-like)
  const cpQuality = computeCounterpartyQuality(f.counterparties);

  const raw = (
    logVolume * 0.25 +
    recency * 0.25 +
    diversityResult * 0.30 +
    cpQuality * 0.20
  ) * 100;

  const score = Math.min(Math.max(raw, 0), 100);

  return {
    score,
    weight: 0.45,
    details: {
      logVolume: round4(logVolume),
      recency: round4(recency),
      diversityScore: round4(diversityResult),
      counterpartyQuality: round4(cpQuality),
    },
  };
}

/** Recency decay per transaction */
export function computeRecency(transactions: TransactionInfo[]): number {
  if (transactions.length === 0) return 0;

  let totalWeight = 0;
  for (const tx of transactions) {
    totalWeight += recencyWeight(tx.daysAgo);
  }
  return totalWeight / transactions.length;
}

function recencyWeight(daysAgo: number): number {
  if (daysAgo <= 30) return 1.0;
  if (daysAgo <= 90) return 0.7;
  if (daysAgo <= 180) return 0.4;
  return 0.15;
}

/** Diversity: penalize concentration + breadth bonus */
export function computeDiversity(
  transactions: TransactionInfo[],
  counterparties: CounterpartyInfo[]
): number {
  if (transactions.length === 0 || counterparties.length === 0) return 0;

  const totalTxs = transactions.length;
  const maxTxCount = Math.max(...counterparties.map(c => c.txCount));
  const topCounterpartyShare = maxTxCount / totalTxs;
  const uniqueCount = counterparties.length;

  const diversity = 1 - topCounterpartyShare;
  const breadthBonus = Math.min(uniqueCount / 50, 1) * 0.2;

  return Math.min(diversity + breadthBonus, 1.0);
}

/** Counterparty quality: weighted avg of counterparty trust scores */
export function computeCounterpartyQuality(counterparties: CounterpartyInfo[]): number {
  // Only include counterparties with score > 20
  const qualified = counterparties.filter(c => c.trustScore !== null && c.trustScore > 20);

  if (qualified.length === 0) return 0.3; // default when no scored counterparties

  const totalTxs = qualified.reduce((sum, c) => sum + c.txCount, 0);
  if (totalTxs === 0) return 0.3;

  let weightedSum = 0;
  for (const cp of qualified) {
    const proportion = cp.txCount / totalTxs;
    weightedSum += (cp.trustScore! / 100) * proportion;
  }

  return Math.min(weightedSum, 1.0);
}

// ──────────────────────────────────────────────────
// Bucket 3: Reliability (20%)
// ──────────────────────────────────────────────────

export function computeReliability(f: ReliabilityFactors): BucketBreakdown {
  if (f.noEndpoint) {
    return {
      score: 50,
      weight: 0.20,
      details: { uptime: 0, validX402: 0, responseTimeScore: 0, noEndpoint: 1 },
    };
  }

  const uptime = f.totalProbes30d > 0
    ? f.successfulProbes30d / f.totalProbes30d
    : 0;

  const validX402 = f.validX402Header ? 1 : 0;
  const responseTimeScore = 1 - Math.min(f.avgResponseMs / 5000, 1);

  const raw = (uptime * 0.5 + validX402 * 0.3 + responseTimeScore * 0.2) * 100;
  const score = Math.min(Math.max(raw, 0), 100);

  return {
    score,
    weight: 0.20,
    details: {
      uptime: round4(uptime),
      validX402,
      responseTimeScore: round4(responseTimeScore),
      noEndpoint: 0,
    },
  };
}

// ──────────────────────────────────────────────────
// Bucket 4: Attestations (15%)
// ──────────────────────────────────────────────────

export function computeAttestation(f: AttestationFactors): BucketBreakdown {
  const humanPts = f.humanVerified ? 30 : 0;
  const peerPts = Math.min(f.peerAttestorCount, 6) * 5; // max 30pts from peers

  const score = Math.min(humanPts + peerPts, 100);

  return {
    score,
    weight: 0.15,
    details: {
      humanVerified: f.humanVerified ? 1 : 0,
      peerAttestorCount: f.peerAttestorCount,
      humanPoints: humanPts,
      peerPoints: peerPts,
    },
  };
}

// ──────────────────────────────────────────────────
// Final composite score
// ──────────────────────────────────────────────────

export function computeScore(factors: ScoreFactors): ScoreResult {
  // Check for "Unscored" — insufficient data
  const isUnscored = factors.activity.transactions.length < 5
    && factors.longevity.daysSinceMint < 7;

  const longevity = computeLongevity(factors.longevity);
  const activity = computeActivity(factors.activity);
  const reliability = computeReliability(factors.reliability);
  const attestation = computeAttestation(factors.attestation);

  const finalScore = Math.round(
    longevity.score * longevity.weight +
    activity.score * activity.weight +
    reliability.score * reliability.weight +
    attestation.score * attestation.weight
  );

  const gradeInfo = isUnscored ? getUnscored() : getGrade(finalScore);

  // Generate improvement tips
  const tips = generateTips(longevity, activity, reliability, attestation, factors);

  // Generate badges
  const badges = generateBadges(longevity, activity, reliability, attestation, factors);

  return {
    score: finalScore,
    grade: gradeInfo.grade,
    label: gradeInfo.label,
    unscored: isUnscored,
    buckets: { longevity, activity, reliability, attestation },
    improvementTips: tips,
    badges,
  };
}

// ──────────────────────────────────────────────────
// Tips & Badges
// ──────────────────────────────────────────────────

function generateTips(
  longevity: BucketBreakdown,
  activity: BucketBreakdown,
  reliability: BucketBreakdown,
  attestation: BucketBreakdown,
  factors: ScoreFactors,
): string[] {
  const tips: string[] = [];

  // Find weakest bucket (by weighted contribution)
  const buckets = [
    { name: 'activity', score: activity.score, weight: 0.45 },
    { name: 'reliability', score: reliability.score, weight: 0.20 },
    { name: 'attestation', score: attestation.score, weight: 0.15 },
    { name: 'longevity', score: longevity.score, weight: 0.20 },
  ];
  buckets.sort((a, b) => a.score - b.score);

  // Activity tips
  if (activity.details.diversityScore < 0.5) {
    const uniqueCount = factors.activity.counterparties.length;
    tips.push(
      `Diversify your counterparties. You transact with only ${uniqueCount} unique agents. ` +
      `Reaching 10+ counterparties would significantly boost your activity score.`
    );
  }
  if (activity.details.logVolume < 0.3) {
    tips.push('Increase your x402 payment volume. Your current volume is low on the log scale.');
  }
  if (activity.details.recency < 0.5) {
    tips.push('Your recent activity is low. Transact more frequently to improve recency.');
  }

  // Reliability tips
  if (reliability.details.noEndpoint === 1) {
    tips.push('Register an endpoint URL to improve your reliability score from the default 50.');
  } else if (reliability.details.validX402 === 0) {
    tips.push('Your endpoint should return a WWW-Authenticate: 402 header for x402 verification.');
  }
  if (reliability.details.uptime < 0.9 && reliability.details.noEndpoint === 0) {
    tips.push('Improve your endpoint uptime. Current uptime is below 90%.');
  }

  // Attestation tips
  if (!factors.attestation.humanVerified) {
    tips.push('Get human verification to earn 30 attestation points.');
  }
  if (factors.attestation.peerAttestorCount < 3) {
    tips.push('Get peer attestations from high-scoring agents (score > 70) to boost your attestation score.');
  }

  return tips.slice(0, 5); // max 5 tips
}

function generateBadges(
  longevity: BucketBreakdown,
  activity: BucketBreakdown,
  reliability: BucketBreakdown,
  attestation: BucketBreakdown,
  factors: ScoreFactors,
): string[] {
  const badges: string[] = [];

  // 🕐 Consistent — active 10+ of last 12 weeks
  if (factors.longevity.activeWeeksLast12 >= 10) badges.push('🕐 Consistent');

  // 🎖️ Veteran — older than 365 days
  if (factors.longevity.daysSinceMint >= 365) badges.push('🎖️ Veteran');

  // 🌐 Well-Connected — 20+ unique counterparties
  if (factors.activity.counterparties.length >= 20) badges.push('🌐 Well-Connected');

  // 💎 High-Volume — $10K+ total volume
  if (factors.activity.totalVolumeUsdc >= 10000) badges.push('💎 High-Volume');

  // 📡 Endpoint Verified — valid x402 endpoint
  if (reliability.details.validX402 === 1) badges.push('📡 Endpoint Verified');

  // ✅ Human Verified
  if (factors.attestation.humanVerified) badges.push('✅ Human Verified');

  // 🏆 Trusted — score >= 80
  if (longevity.score * 0.2 + activity.score * 0.45 + reliability.score * 0.2 + attestation.score * 0.15 >= 80) {
    badges.push('🏆 Trusted');
  }

  return badges;
}

// ──────────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
