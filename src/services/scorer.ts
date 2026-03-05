import { type Address } from 'viem';
import { getAgentIdentity } from '../blockchain/erc8004';
import { getPaymentStats } from '../blockchain/payments';
import { probeEndpoint } from '../probes/endpoint';
import { computeScore, type ScoreResult, type ScoreFactors } from '../scoring/engine';
import { getCachedScore, setCachedScore } from '../cache/redis';
import { getPool } from '../db/client';

export interface AgentScoreResponse {
  agent: string;
  score: number;
  grade: string;
  label: string;
  scoredAt: number;
  freshness: 'live' | 'cached';
}

export interface AgentProfileResponse extends AgentScoreResponse {
  factors: ScoreResult['factors'];
}

async function computeAgentScore(agentAddress: Address): Promise<ScoreResult & { scoredAt: number }> {
  // 1. Get ERC-8004 identity
  const identity = await getAgentIdentity(agentAddress);

  // 2. Get payment stats
  const payments = await getPaymentStats(agentAddress);

  // 3. Probe endpoint if set
  const hasEndpoint = identity.endpoint !== '';
  let endpointReachable = false;
  if (hasEndpoint) {
    const probe = await probeEndpoint(identity.endpoint);
    endpointReachable = probe.reachable;
  }

  // 4. Compute days since first registration
  const daysSinceFirst = identity.registeredAt > 0
    ? (Date.now() / 1000 - identity.registeredAt) / 86400
    : 0;

  // 5. Build factors
  const factors: ScoreFactors = {
    identity: {
      hasERC8004: identity.isRegistered,
      daysSinceFirst,
    },
    payments: {
      txCount: payments.txCount,
      successRate: payments.successRate,
    },
    reliability: {
      endpointReachable,
      noEndpoint: !hasEndpoint,
    },
    attestations: {},
  };

  // 6. Compute score
  const result = computeScore(factors);
  const scoredAt = Math.floor(Date.now() / 1000);

  return { ...result, scoredAt };
}

export async function getAgentScore(agentAddress: Address): Promise<AgentScoreResponse> {
  const addr = agentAddress.toLowerCase();

  // Check cache
  const cached = await getCachedScore(addr);
  if (cached) {
    const data = JSON.parse(cached);
    return { ...data, freshness: 'cached' as const };
  }

  // Compute fresh score
  const result = await computeAgentScore(agentAddress);

  const response: AgentScoreResponse = {
    agent: agentAddress,
    score: result.score,
    grade: result.grade,
    label: result.label,
    scoredAt: result.scoredAt,
    freshness: 'live',
  };

  // Cache the result
  await setCachedScore(addr, JSON.stringify(response));

  // Persist to DB (best-effort)
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO agent_scores (address, score, grade, label, factors, scored_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (address)
       DO UPDATE SET score = $2, grade = $3, label = $4, factors = $5, scored_at = NOW(), updated_at = NOW()`,
      [addr, result.score, result.grade, result.label, JSON.stringify(result.factors)]
    );

    await pool.query(
      `INSERT INTO score_history (address, score, grade, factors, scored_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [addr, result.score, result.grade, JSON.stringify(result.factors)]
    );
  } catch (err) {
    console.error('Failed to persist score:', err);
  }

  return response;
}

export async function getAgentProfile(agentAddress: Address): Promise<AgentProfileResponse> {
  const addr = agentAddress.toLowerCase();

  // Check cache for profile
  const cached = await getCachedScore(addr);
  if (cached) {
    const data = JSON.parse(cached);
    if (data.factors) {
      return { ...data, freshness: 'cached' as const };
    }
  }

  // Compute fresh score with full factors
  const result = await computeAgentScore(agentAddress);

  const response: AgentProfileResponse = {
    agent: agentAddress,
    score: result.score,
    grade: result.grade,
    label: result.label,
    scoredAt: result.scoredAt,
    freshness: 'live',
    factors: result.factors,
  };

  // Cache (includes factors for profile)
  await setCachedScore(addr, JSON.stringify(response));

  // Persist
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO agent_scores (address, score, grade, label, factors, scored_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (address)
       DO UPDATE SET score = $2, grade = $3, label = $4, factors = $5, scored_at = NOW(), updated_at = NOW()`,
      [addr, result.score, result.grade, result.label, JSON.stringify(result.factors)]
    );
  } catch (err) {
    console.error('Failed to persist profile:', err);
  }

  return response;
}
