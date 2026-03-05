# Cred402

x402-native TrustScore API for ERC-8004 AI agents. Provides a credit-score-like rating (0–100) for on-chain AI agents, paid per query via x402 micropayments in USDC on Base.

## Score Buckets

| Bucket | Weight | What It Measures |
|---|---|---|
| **Identity** | 25% | ERC-8004 registration, age, endpoint presence |
| **Payments** | 40% | USDC transaction count on Base, success rate |
| **Reliability** | 20% | HTTP HEAD probe of registered endpoint |
| **Attestations** | 15% | Third-party certifications (stub in MVP) |

### Grade Scale

| Score | Grade | Label |
|---|---|---|
| 90–100 | A | Excellent |
| 75–89 | B | Good |
| 55–74 | C | Fair |
| 35–54 | D | Poor |
| 0–34 | F | High Risk |
| N/A | U | Unscored |

## API Endpoints

```
GET /v1/score/:agent    → { score, grade, label, scoredAt, freshness }
GET /v1/profile/:agent  → { score, grade, factors, scoredAt, freshness }
GET /v1/status          → { ok, version }
```

## x402 Payments

Queries cost **$0.001 USDC** per call (on Base). The first **100 calls per IP** are free (no payment required).

When free tier is exhausted, the API returns a `402 Payment Required` response with x402-compatible payment details. Clients pay USDC on Base to the treasury address and retry with an `X-PAYMENT` header.

**Asset:** USDC on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
**Network:** Base Mainnet

## Local Development

### Prerequisites

- Node.js 22+
- PostgreSQL
- Redis

### Setup

```bash
# Clone and install
git clone https://github.com/darrwalk/cred402.git
cd cred402
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database/redis URLs

# Run database migrations
npm run migrate

# Start development server
npm run dev

# Run tests
npm test
```

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://cred402:cred402@localhost:5432/cred402` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `BASE_RPC_URL` | Base mainnet RPC URL | `https://mainnet.base.org` |
| `CRED402_TREASURY_ADDRESS` | USDC payment destination | — |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |

## Deploy to fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Create app
fly apps create cred402

# Set secrets
fly secrets set \
  DATABASE_URL="postgres://..." \
  REDIS_URL="redis://..." \
  BASE_RPC_URL="https://mainnet.base.org" \
  CRED402_TREASURY_ADDRESS="0x..."

# Deploy
fly deploy

# Run migrations
fly ssh console -C "node dist/db/migrate.js"
```

## Tech Stack

- **Runtime:** Node.js 22 + TypeScript
- **Framework:** Express
- **Blockchain:** viem (read-only, Base)
- **Database:** PostgreSQL
- **Cache:** Redis (6h score TTL)
- **Payments:** x402 (USDC on Base)
- **Hosting:** fly.io

## License

MIT
