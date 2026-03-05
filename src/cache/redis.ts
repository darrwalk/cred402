import Redis from 'ioredis';
import { config } from '../config';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }
  return redis;
}

export async function connectRedis(): Promise<void> {
  const r = getRedis();
  await r.connect();
}

export async function getCachedScore(agent: string): Promise<string | null> {
  const r = getRedis();
  return r.get(`score:${agent.toLowerCase()}`);
}

export async function setCachedScore(agent: string, data: string): Promise<void> {
  const r = getRedis();
  await r.set(`score:${agent.toLowerCase()}`, data, 'EX', config.scoreCacheTtlSeconds);
}

export async function checkRateLimit(ip: string): Promise<{ allowed: boolean; remaining: number }> {
  const r = getRedis();
  const key = `ratelimit:${ip}`;
  const count = await r.incr(key);
  if (count === 1) {
    // Set expiry to 24 hours on first request
    await r.expire(key, 86400);
  }
  const remaining = Math.max(0, config.freeTierLimit - count);
  return { allowed: count <= config.freeTierLimit, remaining };
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
