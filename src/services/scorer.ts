import { type Address } from 'viem';
import { getAgentIdentity } from '../blockchain/erc8004';
import { getAgentTransactionData } from '../blockchain/payments';
import {
  computeScore,
  type ScoreResult,
  type ScoreFactors,
  type TransactionInfo,
  type CounterpartyInfo,
} from '../scoring/engine';
import { getCachedScore, setCachedScore } from '../cache/redis';
import { getPool } from '../db/client';

// ──────────────────────────────────────────────────
// Response types
// ──────────────────────────────────────────────────

export interface AgentScoreResponse {
  agent: string;
  score: number;
  grade: string;
  label: string;
  unscored: boolean;
  scoredAt: number;
  freshness: 'live' | 'cached';
  buckets: ScoreResult['buckets'];
  improvementTips: string[];
  badges: string[];
  weeklyChange: number | null;
}

// ──────────────────────────────────────────────────
// Core scoring flow
// ──────────────────────────────────────────────────

async function computeAgentScore(agentAddress: Address): Promise<ScoreResult & { scoredAt: number }> {
  const pool = getPool();
  const addr = agentAddress.toLowerCase();
  const now = new Date();

  // 1. Get ERC-8004 identity
  const identity = await getAgentIdentity(agentAddress);

  // 2. Get transaction data with counterparties
  const txData = await getAgentTransactionData(agentAddress);

  // 3. Build transaction infos with recency
  const transactions: TransactionInfo[] = txData.transactions.map(tx => {
    const daysAgo = (now.getTime() - tx.blockTimestamp.getTime()) / (1000 * 60 * 60 * 24);
    const counterparty = tx.payer.toLowerCase() === addr ? tx.payee : tx.payer;
    return { amountUsdc: tx.amountUsdc, daysAgo, counterparty };
  });

  // 4. Compute active weeks in last 12 weeks
  const twelveWeeksAgo = new Date(now.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);
  const activeWeeks = new Set<number>();
  for (const tx of txData.transactions) {
    if (tx.blockTimestamp >= twelveWeeksAgo) {
      const weekNum = Math.floor((now.getTime() - tx.blockTimestamp.getTime()) / (7 * 24 * 60 * 60 * 1000));
      activeWeeks.add(weekNum);
    }
  }

  // 5. Get counterparty trust scores from DB
  const counterparties: CounterpartyInfo[] = [];
  for (const cp of txData.counterparties) {
    let trustScore: number | null = null;
    try {
      const result = await pool.query(
        'SELECT score FROM agent_scores WHERE address = $1',
        [cp.counterparty]
      );
      if (result.rows.length > 0) {
        trustScore = result.rows[0].score;
      }
    } catch { /* no score yet */ }

    counterparties.push({
      address: cp.counterparty,
      txCount: cp.txCount,
      trustScore,
    });
  }

  // 6. Get endpoint probe data (last 30 days)
  let successfulProbes = 0;
  let totalProbes = 0;
  let validX402Header = false;
  let avgResponseMs = 0;

  try {
    const probeResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE reachable = true) as successful,
         COUNT(*) as total,
         BOOL_OR(has_x402_header) as has_x402,
         AVG(latency_ms) FILTER (WHERE reachable = true) as avg_ms
       FROM endpoint_probes
       WHERE address = $1 AND probed_at > NOW() - INTERVAL '30 days'`,
      [addr]
    );
    if (probeResult.rows.length > 0) {
      const row = probeResult.rows[0];
      successfulProbes = parseInt(row.successful) || 0;
      totalProbes = parseInt(row.total) || 0;
      validX402Header = row.has_x402 === true;
      avgResponseMs = parseFloat(row.avg_ms) || 0;
    }
  } catch { /* no probes yet */ }

  // 7. Get attestation data
  let humanVerified = false;
  let peerAttestorCount = 0;

  try {
    const agentRow = await pool.query(
      'SELECT human_verified FROM agents WHERE address = $1',
      [addr]
    );
    if (agentRow.rows.length > 0) {
      humanVerified = agentRow.rows[0].human_verified === true;
    }

    const attResult = await pool.query(
      `SELECT COUNT(*) as cnt FROM attestations
       WHERE agent_address = $1 AND attestor_score > 70`,
      [addr]
    );
    peerAttestorCount = parseInt(attResult.rows[0]?.cnt) || 0;
  } catch { /* no attestation data yet */ }

  // 8. Days since mint
  const daysSinceMint = identity.registeredAt > 0
    ? (now.getTime() / 1000 - identity.registeredAt) / 86400
    : 0;

  // 9. Build factors
  const factors: ScoreFactors = {
    longevity: {
      daysSinceMint,
      activeWeeksLast12: activeWeeks.size,
    },
    activity: {
      totalVolumeUsdc: txData.totalVolumeUsdc,
      transactions,
      counterparties,
    },
    reliability: {
      noEndpoint: identity.endpoint === '',
      successfulProbes30d: successfulProbes,
      totalProbes30d: totalProbes,
      validX402Header,
      avgResponseMs,
    },
    attestation: {
      humanVerified,
      peerAttestorCount,
    },
  };

  // 10. Compute
  const result = computeScore(factors);
  const scoredAt = Math.floor(Date.now() / 1000);

  return { ...result, scoredAt };
}

// ──────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────

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

  // Get weekly change
  const weeklyChange = await getWeeklyChange(addr, result.score);

  const response: AgentScoreResponse = {
    agent: agentAddress,
    score: result.score,
    grade: result.grade,
    label: result.label,
    unscored: result.unscored,
    scoredAt: result.scoredAt,
    freshness: 'live',
    buckets: result.buckets,
    improvementTips: result.improvementTips,
    badges: result.badges,
    weeklyChange,
  };

  // Cache
  await setCachedScore(addr, JSON.stringify(response));

  // Persist to DB (best-effort)
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO agent_scores (address, score, grade, label, factors, scored_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (address)
       DO UPDATE SET score = $2, grade = $3, label = $4, factors = $5, scored_at = NOW(), updated_at = NOW()`,
      [addr, result.score, result.grade, result.label, JSON.stringify(result.buckets)]
    );

    await pool.query(
      `INSERT INTO score_history (address, score, grade, factors, scored_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [addr, result.score, result.grade, JSON.stringify(result.buckets)]
    );
  } catch (err) {
    console.error('Failed to persist score:', err);
  }

  return response;
}

async function getWeeklyChange(addr: string, currentScore: number): Promise<number | null> {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT score FROM score_history
       WHERE address = $1 AND scored_at < NOW() - INTERVAL '7 days'
       ORDER BY scored_at DESC LIMIT 1`,
      [addr]
    );
    if (result.rows.length > 0) {
      return currentScore - result.rows[0].score;
    }
    return null; // no history yet
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────
// Leaderboard
// ──────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  agent: string;
  name: string | null;
  score: number;
  grade: string;
  category: string | null;
  weeklyChange: number | null;
}

export async function getLeaderboard(
  limit: number = 100,
  category?: string
): Promise<LeaderboardEntry[]> {
  const pool = getPool();

  let query = `
    SELECT
      s.address,
      s.score,
      s.grade,
      a.name,
      a.category,
      (SELECT s2.score FROM score_history s2
       WHERE s2.address = s.address AND s2.scored_at < NOW() - INTERVAL '7 days'
       ORDER BY s2.scored_at DESC LIMIT 1) as prev_score
    FROM agent_scores s
    LEFT JOIN agents a ON LOWER(a.address) = s.address
    WHERE s.grade != 'U'
  `;
  const params: any[] = [];

  if (category) {
    params.push(category);
    query += ` AND a.category = $${params.length}`;
  }

  params.push(Math.min(limit, 500));
  query += ` ORDER BY s.score DESC LIMIT $${params.length}`;

  const result = await pool.query(query, params);

  return result.rows.map((row: any, idx: number) => ({
    rank: idx + 1,
    agent: row.address,
    name: row.name || null,
    score: row.score,
    grade: row.grade,
    category: row.category || null,
    weeklyChange: row.prev_score != null ? row.score - row.prev_score : null,
  }));
}
