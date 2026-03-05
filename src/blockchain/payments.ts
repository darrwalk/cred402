import { getViemClient } from './client';
import { config } from '../config';
import { type Address, parseAbiItem } from 'viem';

const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

export interface PaymentStats {
  txCount: number;
  successRate: number;
}

export async function getPaymentStats(agentAddress: Address): Promise<PaymentStats> {
  const client = getViemClient();

  try {
    // Get USDC transfer logs where agent is sender
    const sentLogs = await client.getLogs({
      address: config.usdcAddress,
      event: transferEvent,
      args: {
        from: agentAddress,
      },
      fromBlock: 'earliest',
      toBlock: 'latest',
    });

    // Get USDC transfer logs where agent is receiver
    const receivedLogs = await client.getLogs({
      address: config.usdcAddress,
      event: transferEvent,
      args: {
        to: agentAddress,
      },
      fromBlock: 'earliest',
      toBlock: 'latest',
    });

    const txCount = sentLogs.length + receivedLogs.length;
    // For MVP, success rate is 1.0 for all confirmed on-chain transfers
    const successRate = txCount > 0 ? 1.0 : 0;

    return { txCount, successRate };
  } catch {
    return { txCount: 0, successRate: 0 };
  }
}
