-- Apply once to EXISTING databases created from the legacy schema.
-- Run through `wrangler d1 execute <database> --remote --file=...` and record
-- the deployment in your release log. Do not re-run: SQLite ADD COLUMN is not
-- idempotent.

ALTER TABLE velocity_events ADD COLUMN ip_hash TEXT;
ALTER TABLE velocity_events ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_stats ADD COLUMN token_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ip_usage_stats (
    ip_hash TEXT PRIMARY KEY,
    usage_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_velocity_ip_time ON velocity_events(ip_hash, requested_at);
