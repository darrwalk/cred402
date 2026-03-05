import { getGrade, getUnscored, type Grade, type GradeInfo } from './grades';

export interface IdentityFactors {
  hasERC8004: boolean;
  daysSinceFirst: number;
}

export interface PaymentFactors {
  txCount: number;
  successRate: number; // 0-1
}

export interface ReliabilityFactors {
  endpointReachable: boolean;
  noEndpoint: boolean;
}

export interface AttestationFactors {
  // MVP stub
}

export interface ScoreFactors {
  identity: IdentityFactors;
  payments: PaymentFactors;
  reliability: ReliabilityFactors;
  attestations: AttestationFactors;
}

export interface ScoreResult {
  score: number;
  grade: Grade;
  label: string;
  factors: {
    identity: { score: number; weight: number };
    payments: { score: number; weight: number };
    reliability: { score: number; weight: number };
    attestations: { score: number; weight: number };
  };
}

export function computeIdentityScore(f: IdentityFactors): number {
  const base = f.hasERC8004 ? 50 : 20;
  const ageFactor = Math.min(f.daysSinceFirst / 30, 1) * 30;
  return base + ageFactor;
}

export function computePaymentScore(f: PaymentFactors): number {
  const volumeScore = Math.min(f.txCount / 20, 1) * 60;
  const reliabilityScore = f.successRate * 40;
  return volumeScore + reliabilityScore;
}

export function computeReliabilityScore(f: ReliabilityFactors): number {
  if (f.endpointReachable) return 80;
  if (f.noEndpoint) return 50;
  return 0; // endpoint set but unreachable
}

export function computeAttestationScore(_f: AttestationFactors): number {
  return 0; // MVP stub
}

export function computeScore(factors: ScoreFactors): ScoreResult {
  const identityScore = computeIdentityScore(factors.identity);
  const paymentScore = computePaymentScore(factors.payments);
  const reliabilityScore = computeReliabilityScore(factors.reliability);
  const attestationScore = computeAttestationScore(factors.attestations);

  const finalScore = Math.round(
    identityScore * 0.25 +
    paymentScore * 0.40 +
    reliabilityScore * 0.20 +
    attestationScore * 0.15
  );

  const gradeInfo = getGrade(finalScore);

  return {
    score: finalScore,
    grade: gradeInfo.grade,
    label: gradeInfo.label,
    factors: {
      identity: { score: identityScore, weight: 0.25 },
      payments: { score: paymentScore, weight: 0.40 },
      reliability: { score: reliabilityScore, weight: 0.20 },
      attestations: { score: attestationScore, weight: 0.15 },
    },
  };
}
