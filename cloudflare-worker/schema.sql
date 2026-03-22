-- =================================================================
-- CLEAN SLATE (Drop existing tables)
-- =================================================================
DROP TABLE IF EXISTS usage_stats;
DROP TABLE IF EXISTS velocity_events;
DROP TABLE IF EXISTS analytics_daily_requests;
DROP TABLE IF EXISTS analytics_users;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;
-- Cleanup old legacy tables (V1/V2 schema)
DROP TABLE IF EXISTS request_log;
DROP TABLE IF EXISTS daily_usage;

-- =================================================================
-- ROLES TABLE
-- Defines access levels. IDs are human-readable text.
-- =================================================================
CREATE TABLE roles (
    id TEXT PRIMARY KEY,
    daily_limit INTEGER NOT NULL,
    velocity_limit INTEGER NOT NULL,
    description TEXT
);

INSERT INTO roles (id, daily_limit, velocity_limit, description) VALUES
    ('banned', 0, 0, 'Blocked from all access'),
    ('guest', 100, 10, 'Default free tier'),
    ('admin', -1, -1, 'Unlimited access');

-- =================================================================
-- USERS TABLE
-- Tracks clients. 'user_id' is internal integer for speed/references.
-- 'custom_*_limit' allows overriding roles for specific people (e.g. friends).
-- =================================================================
CREATE TABLE users (
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
CREATE TABLE velocity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    model TEXT,
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- =================================================================
-- USAGE STATS (Formerly daily_usage)
-- Tracks daily limits.
-- CLEARED DAILY.
-- =================================================================
CREATE TABLE usage_stats (
    user_id INTEGER PRIMARY KEY,
    usage_count INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

-- =================================================================
-- EXPERIMENTAL ANALYTICS USERS
-- Opt-in keyed-mode telemetry only. No prompts, images, OCR, or keys.
-- =================================================================
CREATE TABLE analytics_users (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    install_id TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =================================================================
-- EXPERIMENTAL ANALYTICS DAILY REQUESTS
-- Per-request records for provider/model/success/token count.
-- =================================================================
CREATE TABLE analytics_daily_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 0,
    token_count INTEGER NOT NULL DEFAULT 0,
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES analytics_users(user_id)
);

-- =================================================================
-- INDEXES
-- Essential for performance and grouping.
-- =================================================================
CREATE INDEX IF NOT EXISTS idx_users_uuid ON users(client_uuid);
CREATE INDEX IF NOT EXISTS idx_users_fingerprint ON users(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_velocity_user_time ON velocity_events(user_id, requested_at);
CREATE INDEX IF NOT EXISTS idx_analytics_users_install_id ON analytics_users(install_id);
CREATE INDEX IF NOT EXISTS idx_analytics_requests_time ON analytics_daily_requests(requested_at);
CREATE INDEX IF NOT EXISTS idx_analytics_requests_provider_model ON analytics_daily_requests(provider, model);
