import { getViemClient } from './client';
import { config } from '../config';
import { type Address, parseAbi } from 'viem';

// Minimal ERC-8004 Identity Registry ABI for read operations
const ERC8004_ABI = parseAbi([
  'function getAgent(address agent) view returns (uint256 agentId, string name, string endpoint, uint256 registeredAt)',
  'function isRegistered(address agent) view returns (bool)',
]);

export interface ERC8004Identity {
  isRegistered: boolean;
  agentId: bigint;
  name: string;
  endpoint: string;
  registeredAt: number;
}

export async function getAgentIdentity(agentAddress: Address): Promise<ERC8004Identity> {
  const client = getViemClient();

  try {
    const isRegistered = await client.readContract({
      address: config.erc8004Registry,
      abi: ERC8004_ABI,
      functionName: 'isRegistered',
      args: [agentAddress],
    });

    if (!isRegistered) {
      return {
        isRegistered: false,
        agentId: 0n,
        name: '',
        endpoint: '',
        registeredAt: 0,
      };
    }

    const result = await client.readContract({
      address: config.erc8004Registry,
      abi: ERC8004_ABI,
      functionName: 'getAgent',
      args: [agentAddress],
    }) as [bigint, string, string, bigint];

    return {
      isRegistered: true,
      agentId: result[0],
      name: result[1],
      endpoint: result[2],
      registeredAt: Number(result[3]),
    };
  } catch {
    // Contract might not exist or agent not registered
    return {
      isRegistered: false,
      agentId: 0n,
      name: '',
      endpoint: '',
      registeredAt: 0,
    };
  }
}
