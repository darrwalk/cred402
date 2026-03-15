export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgres://cred402:cred402@localhost:5432/cred402',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  baseRpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  treasuryAddress: (process.env.CRED402_TREASURY_ADDRESS || '0xD6Ae8D2F816EE123E77D1D698f8a3873A563CB5F') as `0x${string}`,

  // Constants
  usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
  erc8004Registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as `0x${string}`,
  network: 'eip155:8453' as const, // Base mainnet (CAIP-2 format)

  // Scoring
  scoreCacheTtlSeconds: 6 * 60 * 60, // 6 hours
  freeTierLimit: 100,

  // x402 pricing
  scorePrice: '$0.001' as const,
  profilePrice: '$0.001' as const,

  // x402 facilitator
  facilitatorUrl: process.env.X402_FACILITATOR_URL || 'https://facilitator.x402.org',
} as const;
