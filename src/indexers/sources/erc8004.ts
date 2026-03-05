import { createPublicClient, http, parseAbi, type Address } from 'viem';
import { base } from 'viem/chains';

export interface ERC8004Agent {
  address: string;
  agentId: string;
  name: string;
  endpoint: string;
  registeredAt: number;
}

const REGISTRY_ABI = parseAbi([
  'function getAgent(address agent) view returns (uint256 agentId, string name, string endpoint, uint256 registeredAt)',
  'function isRegistered(address agent) view returns (bool)',
  'function totalAgents() view returns (uint256)',
  'event AgentRegistered(address indexed agent, uint256 indexed agentId, string name, string endpoint)',
  'event AgentUpdated(address indexed agent, string name, string endpoint)',
]);

/**
 * Crawl the ERC-8004 Identity Registry on Base mainnet for registered agents.
 * Uses chunked log queries to avoid 413 errors from RPC.
 */
export async function crawlERC8004(
  registryAddress: string = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  rpcUrl: string = 'https://mainnet.base.org'
): Promise<ERC8004Agent[]> {
  console.log('[erc8004] Starting on-chain crawl...');
  console.log(`  [erc8004] Registry: ${registryAddress}`);

  const agents: ERC8004Agent[] = [];

  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  // Scan for AgentRegistered events in chunks of 10k blocks
  try {
    const currentBlock = await client.getBlockNumber();
    const CHUNK_SIZE = 10000n;
    // Scan last ~100k blocks (~4 days on Base at ~2s blocks)
    const startBlock = currentBlock > 100000n ? currentBlock - 100000n : 0n;

    console.log(`  [erc8004] Scanning blocks ${startBlock}–${currentBlock} in chunks of ${CHUNK_SIZE}...`);

    for (let from = startBlock; from <= currentBlock; from += CHUNK_SIZE) {
      const to = from + CHUNK_SIZE - 1n > currentBlock ? currentBlock : from + CHUNK_SIZE - 1n;
      try {
        const logs = await client.getLogs({
          address: registryAddress as Address,
          event: REGISTRY_ABI[3], // AgentRegistered
          fromBlock: from,
          toBlock: to,
        });

        for (const log of logs) {
          const args = log.args as any;
          if (args) {
            agents.push({
              address: args.agent || '',
              agentId: (args.agentId || 0n).toString(),
              name: args.name || '',
              endpoint: args.endpoint || '',
              registeredAt: 0,
            });
          }
        }
      } catch (err: any) {
        // Skip chunk on error
        console.log(`  [erc8004] Chunk ${from}–${to} failed: ${err.message?.slice(0, 80)}`);
      }
    }

    console.log(`  [erc8004] Found ${agents.length} agent(s) from events`);
  } catch (err: any) {
    console.log(`  [erc8004] Event scan failed: ${err.message?.slice(0, 200)}`);
  }

  // Also check known addresses
  const knownAddresses: Address[] = [
    '0xD6Ae8D2F816EE123E77D1D698f8a3873A563CB5F',
  ];

  for (const addr of knownAddresses) {
    try {
      const isRegistered = await client.readContract({
        address: registryAddress as Address,
        abi: REGISTRY_ABI,
        functionName: 'isRegistered',
        args: [addr],
      });

      if (isRegistered) {
        const result = await client.readContract({
          address: registryAddress as Address,
          abi: REGISTRY_ABI,
          functionName: 'getAgent',
          args: [addr],
        }) as [bigint, string, string, bigint];

        agents.push({
          address: addr,
          agentId: result[0].toString(),
          name: result[1],
          endpoint: result[2],
          registeredAt: Number(result[3]),
        });
      }
    } catch { /* skip */ }
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = agents.filter(a => {
    const key = a.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[erc8004] Total unique: ${unique.length} agent(s)`);
  return unique;
}
