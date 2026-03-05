import https from 'https';

export interface Scan8004Agent {
  agentId: string;
  address: string;
  chain: string;
  chainId: number;
  endpoint: string;
  name: string;
  description?: string;
  x402Supported: boolean;
  registeredAt?: string;
}

function fetchJson(url: string, maxRedirects = 3): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'cred402-indexer/1.0',
        'Accept': 'application/json',
      },
      timeout: 30000,
    }, (res) => {
      // Handle redirects (301, 302, 307, 308)
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (maxRedirects <= 0) {
          reject(new Error(`Too many redirects for ${url}`));
          return;
        }
        return fetchJson(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
      }

      // Handle JSON redirect body (8004scan specific)
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // Check for soft redirect in JSON body
          if (parsed.redirect && parsed.status === '307' && maxRedirects > 0) {
            return fetchJson(parsed.redirect, maxRedirects - 1).then(resolve).catch(reject);
          }
          resolve(parsed);
        }
        catch { reject(new Error(`Invalid JSON from ${url}: ${data.slice(0, 200)}`)); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

const CHAIN_ID_MAP: Record<number, string> = {
  1: 'ethereum',
  8453: 'base',
  84532: 'base-sepolia',
  42220: 'celo',
  56: 'bsc',
  137: 'polygon',
  10: 'optimism',
  42161: 'arbitrum',
};

/**
 * Extract primary endpoint from 8004scan agent services.
 */
function extractEndpoint(agent: any): string {
  if (!agent.services) return '';
  // Priority: web > api > mcp > a2a
  for (const key of ['web', 'api', 'mcp', 'a2a']) {
    if (agent.services[key]?.endpoint) {
      const ep = agent.services[key].endpoint;
      if (ep.startsWith('http://') || ep.startsWith('https://')) return ep;
    }
  }
  return '';
}

/**
 * Crawl 8004scan.io API for all registered ERC-8004 agents.
 * Paginated — fetches all pages.
 */
export async function crawlScan8004(): Promise<Scan8004Agent[]> {
  console.log('[8004scan] Starting crawl of 8004scan.io...');
  const agents: Scan8004Agent[] = [];
  const PAGE_SIZE = 100;
  let offset = 0;
  let total = 0;

  // Try multiple API base URLs
  const baseUrls = [
    'https://www.8004scan.io/api/v1/agents',
    'https://8004scan.io/api/v1/agents',
  ];
  let apiBase = '';

  for (const base of baseUrls) {
    try {
      const test = await fetchJson(`${base}?limit=1&offset=0`);
      if (test.total !== undefined && test.items) {
        apiBase = base;
        total = test.total;
        console.log(`  [8004scan] Using API: ${base}`);
        console.log(`  [8004scan] Total agents on 8004scan: ${total}`);
        break;
      }
    } catch (err: any) {
      console.log(`  [8004scan] ${base} failed: ${err.message?.slice(0, 100)}`);
    }
  }

  if (!apiBase || total === 0) {
    console.log('  [8004scan] Could not connect to 8004scan API');
    return agents;
  }

  try {
    // Cap at 10k to be reasonable about time
    const maxAgents = Math.min(total, 10000);

    while (offset < maxAgents) {
      try {
        if (offset % 1000 === 0) {
          console.log(`  [8004scan] Fetching offset=${offset}/${maxAgents}...`);
        }
        const page = await fetchJson(`${apiBase}?limit=${PAGE_SIZE}&offset=${offset}`);
        if (!page.items || page.items.length === 0) break;
        processItems(page.items, agents);
        offset += PAGE_SIZE;
        // Small delay to be polite
        await new Promise(r => setTimeout(r, 200));
      } catch (err: any) {
        console.log(`  [8004scan] Page fetch error at offset=${offset}: ${err.message}`);
        // Try to continue from next page
        offset += PAGE_SIZE;
      }
    }
  } catch (err: any) {
    console.error(`  [8004scan] Crawl failed: ${err.message}`);
  }

  // Deduplicate by address
  const seen = new Set<string>();
  const unique = agents.filter(a => {
    const key = a.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[8004scan] Crawled ${offset} entries, extracted ${unique.length} unique agents (${agents.length} total before dedup)`);
  return unique;
}

function processItems(items: any[], agents: Scan8004Agent[]): void {
  for (const item of items) {
    if (!item.owner_address && !item.agent_wallet) continue;

    const address = item.agent_wallet || item.owner_address || '';
    const chainId = item.chain_id || 8453;
    const chain = CHAIN_ID_MAP[chainId] || `chain-${chainId}`;
    const endpoint = extractEndpoint(item);
    const name = item.name || `Agent #${item.token_id || 'unknown'}`;

    agents.push({
      agentId: item.agent_id || `${chainId}:${item.contract_address}:${item.token_id}`,
      address,
      chain,
      chainId,
      endpoint,
      name,
      description: item.description?.slice(0, 500),
      x402Supported: item.x402_supported === true,
      registeredAt: item.created_at,
    });
  }
}
