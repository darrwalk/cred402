import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { RoutesConfig } from '@x402/core/server';

// --- Route definitions for x402-protected endpoints ---

const routes: RoutesConfig = {
  'GET /v1/score/*': {
    accepts: {
      scheme: 'exact',
      price: config.scorePrice,
      network: config.network,
      payTo: config.treasuryAddress,
      maxTimeoutSeconds: 60,
      extra: {
        name: 'USD Coin',
        version: '2',
      },
    },
    resource: 'https://api.cred402.com/v1/score/{agent}',
    description: 'Query the Cred402 TrustScore for an ERC-8004 AI agent. Returns a 0-100 score with grade, category breakdowns, badges, and improvement tips.',
    mimeType: 'application/json',
  },
  'GET /v1/profile/*': {
    accepts: {
      scheme: 'exact',
      price: config.profilePrice,
      network: config.network,
      payTo: config.treasuryAddress,
      maxTimeoutSeconds: 60,
      extra: {
        name: 'USD Coin',
        version: '2',
      },
    },
    resource: 'https://api.cred402.com/v1/profile/{agent}',
    description: 'Get the full agent profile including TrustScore, historical data, and on-chain activity summary.',
    mimeType: 'application/json',
  },
};

// --- Set up facilitator client + resource server ---

const facilitatorClient = new HTTPFacilitatorClient({
  url: config.facilitatorUrl,
});

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(config.network, new ExactEvmScheme());

// --- Export the middleware ---

/**
 * Standard x402 payment middleware using @x402/express.
 * Handles 402 responses, payment verification via facilitator, and settlement.
 */
export function createX402Middleware() {
  return paymentMiddleware(routes, resourceServer);
}

/**
 * Free-tier gate: if the request has been marked as freeTier by the rate limiter,
 * skip the x402 middleware entirely. Otherwise, delegate to x402.
 */
export function x402WithFreeTier() {
  const x402 = createX402Middleware();

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip payment for free-tier requests
    if ((req as any).freeTier) {
      next();
      return;
    }

    // Delegate to standard x402 middleware
    return x402(req, res, next);
  };
}
