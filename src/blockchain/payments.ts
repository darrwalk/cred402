import { getViemClient } from './client';
import { config } from '../config';
import { type Address, parseAbiItem, formatUnits } from 'viem';
import { getPool } from '../db/client';

const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

// USDC has 6 decimals
const USDC_DECIMALS = 6;

export interface TransactionRecord {
  txHash: string;
  payer: string;
  payee: string;
  amountUsdc: number;
  blockNumber: bigint;
  blockTimestamp: Date;
  source: string;
}

export interface CounterpartyStats {
  counterparty: string;
  txCount: number;
  totalVolume: number;
  lastTxAt: Date;
}

export interface AgentTransactionData {
  transactions: TransactionRecord[];
  counterparties: CounterpartyStats[];
  totalTxCount: number;
  totalVolumeUsdc: number;
}

/**
 * Get full transaction data for an agent from the DB.
 * Used by the scoring engine for v2 calculations.
 */
export async function getAgentTransactionData(agentAddress: Address): Promise<AgentTransactionData> {
  const pool = getPool();
  const addr = agentAddress.toLowerCase();

  // Get all transactions where agent is payer or payee
  const txResult = await pool.query(
    `SELECT tx_hash, payer, payee, amount_usdc, block_number, block_timestamp, source
     FROM agent_transactions
     WHERE payer = $1 OR payee = $1
     ORDER BY block_timestamp DESC`,
    [addr]
  );

  const transactions: TransactionRecord[] = txResult.rows.map((r: any) => ({
    txHash: r.tx_hash,
    payer: r.payer,
    payee: r.payee,
    amountUsdc: parseFloat(r.amount_usdc),
    blockNumber: BigInt(r.block_number),
    blockTimestamp: new Date(r.block_timestamp),
    source: r.source,
  }));

  // Get counterparty stats
  const cpResult = await pool.query(
    `SELECT counterparty, tx_count, total_volume, last_tx_at
     FROM agent_counterparties
     WHERE agent = $1
     ORDER BY tx_count DESC`,
    [addr]
  );

  const counterparties: CounterpartyStats[] = cpResult.rows.map((r: any) => ({
    counterparty: r.counterparty,
    txCount: r.tx_count,
    totalVolume: parseFloat(r.total_volume),
    lastTxAt: new Date(r.last_tx_at),
  }));

  const totalTxCount = transactions.length;
  const totalVolumeUsdc = transactions.reduce((sum, tx) => sum + tx.amountUsdc, 0);

  return { transactions, counterparties, totalTxCount, totalVolumeUsdc };
}

/**
 * Index USDC transfers for an agent from the chain.
 * Stores full counterparty data in agent_transactions and updates agent_counterparties.
 */
export async function indexAgentTransactions(agentAddress: Address): Promise<number> {
  const client = getViemClient();
  const pool = getPool();
  const addr = agentAddress.toLowerCase();

  try {
    // Get USDC transfers where agent is sender
    const sentLogs = await client.getLogs({
      address: config.usdcAddress,
      event: transferEvent,
      args: { from: agentAddress },
      fromBlock: 'earliest',
      toBlock: 'latest',
    });

    // Get USDC transfers where agent is receiver
    const receivedLogs = await client.getLogs({
      address: config.usdcAddress,
      event: transferEvent,
      args: { to: agentAddress },
      fromBlock: 'earliest',
      toBlock: 'latest',
    });

    // Get block timestamps (batch unique blocks)
    const allLogs = [...sentLogs, ...receivedLogs];
    const uniqueBlocks = [...new Set(allLogs.map(l => l.blockNumber))];
    const blockTimestamps = new Map<bigint, Date>();

    for (const blockNum of uniqueBlocks) {
      try {
        const block = await client.getBlock({ blockNumber: blockNum });
        blockTimestamps.set(blockNum, new Date(Number(block.timestamp) * 1000));
      } catch {
        blockTimestamps.set(blockNum, new Date());
      }
    }

    // Counterparty aggregation map
    const cpMap = new Map<string, { txCount: number; totalVolume: number; lastTxAt: Date }>();

    let indexed = 0;
    for (const log of allLogs) {
      const from = (log.args.from as string).toLowerCase();
      const to = (log.args.to as string).toLowerCase();
      const amount = parseFloat(formatUnits(log.args.value as bigint, USDC_DECIMALS));
      const blockTs = blockTimestamps.get(log.blockNumber) || new Date();
      const counterparty = from === addr ? to : from;

      // Upsert transaction
      await pool.query(
        `INSERT INTO agent_transactions (tx_hash, payer, payee, amount_usdc, block_number, block_timestamp, source)
         VALUES ($1, $2, $3, $4, $5, $6, 'usdc_transfer')
         ON CONFLICT (tx_hash) DO NOTHING`,
        [log.transactionHash, from, to, amount, Number(log.blockNumber), blockTs]
      );

      // Aggregate counterparty
      const existing = cpMap.get(counterparty) || { txCount: 0, totalVolume: 0, lastTxAt: new Date(0) };
      existing.txCount += 1;
      existing.totalVolume += amount;
      if (blockTs > existing.lastTxAt) existing.lastTxAt = blockTs;
      cpMap.set(counterparty, existing);

      indexed++;
    }

    // Upsert counterparty stats
    for (const [cp, stats] of cpMap.entries()) {
      await pool.query(
        `INSERT INTO agent_counterparties (agent, counterparty, tx_count, total_volume, last_tx_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (agent, counterparty)
         DO UPDATE SET tx_count = $3, total_volume = $4, last_tx_at = $5`,
        [addr, cp, stats.txCount, stats.totalVolume, stats.lastTxAt]
      );
    }

    return indexed;
  } catch (err) {
    console.error('Failed to index transactions for', addr, err);
    return 0;
  }
}
