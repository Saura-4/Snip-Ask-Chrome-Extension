-- Bootstrap schema for a NEW D1 database only.
-- Do not run this against an existing production database. Use the numbered
-- migrations in migrations/ instead; this file deliberately never drops data.

-- =================================================================
-- ROLES TABLE
-- Defines access levels. IDs are human-readable text.
-- =================================================================
CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    daily_limit INTEGER NOT NULL,
    velocity_limit INTEGER NOT NULL,
    description TEXT
);

INSERT OR IGNORE INTO roles (id, daily_limit, velocity_limit, description) VALUES
    ('banned', 0, 0, 'Blocked from all access'),
    ('guest', 100, 10, 'Default free tier'),
    ('admin', -1, -1, 'Unlimited access');

-- =================================================================
-- USERS TABLE
-- Tracks clients. 'user_id' is internal integer for speed/references.
-- 'custom_*_limit' allows overriding roles for specific people (e.g. friends).
-- =================================================================
CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_uuid TEXT UNIQUE NOT NULL,
    device_fingerprint TEXT NOT NULL,
    role_id TEXT DEFAULT 'guest',
    custom_daily_limit INTEGER,
    custom_velocity_limit INTEGER,
    ban_reason TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- =================================================================
-- VELOCITY EVENTS (Formerly request_log)
-- Transient log for speed limit checks. 
-- CLEARED HOURLY.
-- =================================================================
CREATE TABLE IF NOT EXISTS velocity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    ip_hash TEXT NOT NULL,
    model TEXT,
    mode TEXT,
    tokens INTEGER NOT NULL DEFAULT 0,
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- =================================================================
-- USAGE STATS (Formerly daily_usage)
-- Tracks daily limits.
-- CLEARED DAILY.
-- =================================================================
CREATE TABLE IF NOT EXISTS usage_stats (
    user_id INTEGER PRIMARY KEY,
    usage_count INTEGER DEFAULT 0,
    token_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- Per-network counters make client-generated IDs insufficient to bypass
-- guest limits. The IP itself is never stored: only a keyed HMAC is retained.
CREATE TABLE IF NOT EXISTS ip_usage_stats (
    ip_hash TEXT PRIMARY KEY,
    usage_count INTEGER NOT NULL DEFAULT 0
);

-- =================================================================
-- INDEXES
-- Essential for performance and grouping.
-- =================================================================
CREATE INDEX IF NOT EXISTS idx_users_uuid ON users(client_uuid);
CREATE INDEX IF NOT EXISTS idx_users_fingerprint ON users(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_velocity_user_time ON velocity_events(user_id, requested_at);
CREATE INDEX IF NOT EXISTS idx_velocity_ip_time ON velocity_events(ip_hash, requested_at);
