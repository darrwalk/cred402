-- Cred402 initial schema

CREATE TABLE IF NOT EXISTS agent_scores (
  address       TEXT PRIMARY KEY,
  score         INTEGER NOT NULL DEFAULT 0,
  grade         TEXT NOT NULL DEFAULT 'U',
  label         TEXT NOT NULL DEFAULT 'Unscored',
  factors       JSONB NOT NULL DEFAULT '{}',
  scored_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_scores_scored_at ON agent_scores(scored_at);

CREATE TABLE IF NOT EXISTS score_history (
  id            SERIAL PRIMARY KEY,
  address       TEXT NOT NULL REFERENCES agent_scores(address),
  score         INTEGER NOT NULL,
  grade         TEXT NOT NULL,
  factors       JSONB NOT NULL DEFAULT '{}',
  scored_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_score_history_address ON score_history(address);
CREATE INDEX IF NOT EXISTS idx_score_history_scored_at ON score_history(scored_at);
