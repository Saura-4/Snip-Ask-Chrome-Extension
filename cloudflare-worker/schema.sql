-- Cloudflare D1 Schema for Guest Mode Anti-Cheat
-- Run with: wrangler d1 execute snip-ask-guest --file=./schema.sql

-- Users table: links client_uuid to device_fingerprint
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_uuid TEXT UNIQUE NOT NULL,
    device_fingerprint TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Daily usage table: tracks usage per device fingerprint per day
CREATE TABLE IF NOT EXISTS daily_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_fingerprint TEXT NOT NULL,
    usage_date DATE NOT NULL,
    usage_count INTEGER DEFAULT 0,
    last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_fingerprint, usage_date)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_fingerprint ON users(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_usage_fingerprint_date ON daily_usage(device_fingerprint, usage_date);
