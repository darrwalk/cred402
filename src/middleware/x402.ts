import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

// x402 payment middleware
// Uses @coinbase/x402-express when available, falls back to manual 402 response
export function x402PaymentMiddleware(priceUsd: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip if free tier
    if ((req as any).freeTier) {
      next();
      return;
    }

    // Check for x402 payment header
    const paymentHeader = req.headers['x-payment'];
    if (paymentHeader) {
      // In production, verify payment via x402 facilitator
      // For MVP, accept the header as proof of payment
      next();
      return;
    }

    // Return 402 Payment Required
    res.status(402).json({
      x402Version: 1,
      error: 'X-PAYMENT required',
      accepts: [
        {
          scheme: 'exact',
          network: config.network,
          maxAmountRequired: priceToSmallestUnit(priceUsd),
          asset: config.usdcAddress,
          payTo: config.treasuryAddress,
          extra: {
            name: 'Cred402 TrustScore API',
            description: `Score query - ${priceUsd} USDC`,
          },
        },
      ],
    });
  };
}

function priceToSmallestUnit(price: string): string {
  // Convert "$0.001" to USDC smallest unit (6 decimals)
  const num = parseFloat(price.replace('$', ''));
  return Math.round(num * 1_000_000).toString();
}
