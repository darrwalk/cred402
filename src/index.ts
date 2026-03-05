import { createApp } from './app';
import { config } from './config';
import { getRedis } from './cache/redis';

async function main() {
  const app = createApp();

  // Connect to Redis (lazy — connects on first use)
  const redis = getRedis();
  redis.on('error', (err) => console.error('Redis error:', err));
  redis.on('connect', () => console.log('Redis connected'));

  // Note: PostgreSQL connects lazily via Pool

  app.listen(config.port, () => {
    console.log(`Cred402 API listening on port ${config.port}`);
    console.log(`Environment: ${config.nodeEnv}`);
    console.log(`Treasury: ${config.treasuryAddress}`);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
