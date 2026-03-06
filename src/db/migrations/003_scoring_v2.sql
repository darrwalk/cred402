-- Scoring v2: counterparty-tracking transactions, endpoint probes, attestations

-- Full transaction records with counterparty data
CREATE TABLE IF NOT EXISTS agent_transactions (
  id            SERIAL PRIMARY KEY,
  tx_hash       TEXT NOT NULL,
  payer         TEXT NOT NULL,
  payee         TEXT NOT NULL,
  amount_usdc   NUMERIC(18, 6) NOT NULL,    -- human-readable USDC amount
  block_number  BIGINT NOT NULL,
  block_timestamp TIMESTAMPTZ NOT NULL,
  source        TEXT NOT NULL DEFAULT 'usdc_transfer',  -- 'facilitator' or 'usdc_transfer'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tx_hash ON agent_transactions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_agent_tx_payer ON agent_transactions(payer);
CREATE INDEX IF NOT EXISTS idx_agent_tx_payee ON agent_transactions(payee);
CREATE INDEX IF NOT EXISTS idx_agent_tx_timestamp ON agent_transactions(block_timestamp);

-- Materialized counterparty view for fast scoring
CREATE TABLE IF NOT EXISTS agent_counterparties (
  agent         TEXT NOT NULL,
  counterparty  TEXT NOT NULL,
  tx_count      INTEGER NOT NULL DEFAULT 0,
  total_volume  NUMERIC(18, 6) NOT NULL DEFAULT 0,
  last_tx_at    TIMESTAMPTZ,
  PRIMARY KEY (agent, counterparty)
);

CREATE INDEX IF NOT EXISTS idx_agent_cp_agent ON agent_counterparties(agent);

-- Endpoint probe results (hourly probes)
CREATE TABLE IF NOT EXISTS endpoint_probes (
  id            SERIAL PRIMARY KEY,
  address       TEXT NOT NULL,
  endpoint_url  TEXT NOT NULL,
  reachable     BOOLEAN NOT NULL,
  status_code   INTEGER,
  latency_ms    INTEGER NOT NULL DEFAULT 0,
  has_x402_header BOOLEAN NOT NULL DEFAULT FALSE,
  probed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_probes_address ON endpoint_probes(address);
CREATE INDEX IF NOT EXISTS idx_probes_probed_at ON endpoint_probes(probed_at);

-- Attestations
CREATE TABLE IF NOT EXISTS attestations (
  id            SERIAL PRIMARY KEY,
  agent_address TEXT NOT NULL,
  attestor      TEXT NOT NULL,
  attestor_score INTEGER NOT NULL DEFAULT 0,   -- score at time of attestation
  att_type      TEXT NOT NULL DEFAULT 'peer',   -- 'peer' or 'human'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_att_agent_attestor ON attestations(agent_address, attestor);
CREATE INDEX IF NOT EXISTS idx_att_agent ON attestations(agent_address);

-- Add human_verified to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS human_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Add category to agents table for leaderboard filtering
ALTER TABLE agents ADD COLUMN IF NOT EXISTS category TEXT;
