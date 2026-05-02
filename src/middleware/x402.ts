import { Request, Response, NextFunction } from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { config } from '../config';

/**
 * x402 payment middleware using PayAI Network facilitator.
 *
 * - Base Sepolia testnet (eip155:84532)
 * - USDC (testnet) asset
 * - $0.001 per query
 * - Free tier bypass when req.freeTier is true
 */

// Use env var with fallback to payai.network (live facilitator)
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://facilitator.payai.network';

// Route payment configurations for x402
const X402_ROUTES: Record<string, {
  accepts: { scheme: string; price: string; network: string; payTo: string; asset: string };
  description: string;
}> = {
  'GET /v1/score/:agent': {
    accepts: {
      scheme: 'exact',
      price: '$0.001',
      network: 'eip155:84532', // Base Sepolia testnet
      payTo: config.treasuryAddress,
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia testnet USDC
    },
    description:
      'Query the Cred402 TrustScore for an ERC-8004 AI agent. Returns a 0-100 score with grade, category breakdowns, badges, and improvement tips.',
  },
  'GET /v1/profile/:agent': {
    accepts: {
      scheme: 'exact',
      price: '$0.001',
      network: 'eip155:84532', // Base Sepolia testnet
      payTo: config.treasuryAddress,
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia testnet USDC
    },
    description:
      'Get the full agent profile including TrustScore, historical data, and on-chain activity summary.',
  },
};

// Build the x402 resource server with PayAI Network facilitator
let _middleware: ReturnType<typeof paymentMiddleware> | null = null;

function getPaymentMiddleware() {
  if (!_middleware) {
    console.log('[x402] Initializing payment middleware');
    console.log('[x402] Facilitator URL:', FACILITATOR_URL);
    console.log('[x402] Env X402_FACILITATOR_URL:', process.env.X402_FACILITATOR_URL || '(not set)');
    console.log('[x402] Network: eip155:84532 (Base Sepolia testnet)');
    console.log('[x402] USDC:', config.usdcAddress);
    console.log('[x402] Treasury:', config.treasuryAddress);
    console.log('[x402] FREE_TIER_LIMIT:', process.env.FREE_TIER_LIMIT);

    const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
    const resourceServer = new x402ResourceServer(facilitatorClient)
      .register('eip155:84532', new ExactEvmScheme()); // Base Sepolia

    _middleware = paymentMiddleware(
      X402_ROUTES,
      resourceServer,
      undefined, // no paywall config
      undefined, // no custom paywall
      true,      // sync facilitator on start
    );
  }
  return _middleware;
}

/**
 * Wraps the @x402/express payment middleware with free-tier bypass and error handling.
 *
 * Usage in app.ts:  app.use(x402Gate())
 */
export function x402Gate() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const isFree = (req as any).freeTier === true;
    const hasPaymentHeader = !!(req.headers['x-402-payment'] || req.headers['x402-payment']);

    console.log(`[x402] Gate hit: ${req.method} ${req.path} | freeTier=${isFree} | hasPaymentHeader=${hasPaymentHeader}`);
    console.log(`[x402] Request headers: x402-payment=${req.headers['x-402-payment'] || '(none)'}, authorization=${req.headers['authorization'] ? 'present' : '(none)'}`);

    // Free tier bypass — set by rate limiter middleware
    if (isFree) {
      console.log('[x402] Free tier bypass — skipping payment check');
      next();
      return;
    }

    console.log('[x402] No free tier — invoking payment middleware');
    console.log('[x402] Using facilitator:', FACILITATOR_URL);

    try {
      const mw = getPaymentMiddleware();
      console.log('[x402] Middleware initialized:', mw ? 'yes' : 'no');

      // Hook into response to capture what happens during middleware
      const originalWrite = res.write.bind(res);
      const originalEnd = res.end.bind(res);
      const chunks: Buffer[] = [];

      res.write = function(chunk: any, ...args: any[]) {
        if (chunk) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          chunks.push(buf);
        }
        return originalWrite(chunk, ...args);
      } as typeof res.write;

      res.end = function(chunk: any, ...args: any[]) {
        if (chunk) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          chunks.push(buf);
        }
        return originalEnd(chunk, ...args);
      } as typeof res.end;

      // Save status before middleware
      const statusBefore = res.statusCode;
      console.log(`[x402] Status BEFORE middleware: ${statusBefore}`);

      await mw(req, res, next);

      // Status after middleware
      const statusAfter = res.statusCode;
      const headersAfter = JSON.stringify(res.getHeaders());
      console.log(`[x402] Payment middleware completed.`);
      console.log(`[x402] Status: BEFORE=${statusBefore} → AFTER=${statusAfter}`);
      console.log(`[x402] Response headers after: ${headersAfter}`);

      // If middleware returned 200 (should have been 402), log evidence
      if (statusAfter === 200 && !isFree && !hasPaymentHeader) {
        console.error('[x402] ⚠️  BUG: Payment middleware returned 200 but no payment header present and free tier is exhausted!');
        console.error(`[x402] This means the x402 middleware did NOT enforce payment.`);
        console.error(`[x402] Debug: facilitator=${FACILITATOR_URL}, freeTier=${isFree}, payHeader=${hasPaymentHeader}`);
        if (chunks.length > 0) {
          const body = Buffer.concat(chunks).toString('utf-8').slice(0, 500);
          console.error(`[x402] Response body (first 500 chars): ${body}`);
        }
      }
    } catch (err) {
      console.error('[x402] Facilitator error:', err);
      res.status(503).json({
        error: 'Payment verification service temporarily unavailable',
        message: 'The x402 facilitator is unreachable. Please try again later.',
      });
    }
  };
}

/**
 * @deprecated Use x402Gate() instead. Kept for backward compatibility.
 */
export function x402PaymentGate(_routeType: 'score' | 'profile') {
  return x402Gate();
}
