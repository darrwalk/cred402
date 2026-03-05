import { createPublicClient, http, type PublicClient } from 'viem';
import { base } from 'viem/chains';
import { config } from '../config';

let client: PublicClient | null = null;

export function getViemClient(): PublicClient {
  if (!client) {
    client = createPublicClient({
      chain: base,
      transport: http(config.baseRpcUrl),
    }) as PublicClient;
  }
  return client;
}
