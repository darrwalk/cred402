import { Request, Response, NextFunction } from 'express';
import { checkRateLimit } from '../cache/redis';

export function freeTierRateLimit() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // If request has x402 payment header, skip rate limiting
    if (req.headers['x-payment']) {
      next();
      return;
    }

    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const { allowed, remaining } = await checkRateLimit(ip);

      res.setHeader('X-RateLimit-Remaining', remaining.toString());

      if (!allowed) {
        // Let x402 middleware handle payment requirement
        next();
        return;
      }

      // Free tier: skip x402 payment
      (req as any).freeTier = true;
      next();
    } catch (err) {
      // If Redis is down, default to requiring payment (let x402 handle it)
      console.error('Rate limit check failed (Redis down?), falling through to x402:', err);
      next();
    }
  };
}
