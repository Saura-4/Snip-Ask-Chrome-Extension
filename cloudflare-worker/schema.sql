-- Snip & Ask Guest Mode Database Schema
-- Version 2.0 - Role-Based Access Control

-- Clean slate (drop in reverse dependency order)
DROP TABLE IF EXISTS request_log;
DROP TABLE IF EXISTS daily_usage;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;

-- =================================================================
-- ROLES TABLE
-- Defines access levels and their limits. Add new roles here.
-- Use -1 for unlimited (admin bypass).
-- =================================================================
CREATE TABLE roles (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    daily_limit INTEGER NOT NULL,
    velocity_limit INTEGER NOT NULL,
    description TEXT
);

INSERT INTO roles (id, name, daily_limit, velocity_limit, description) VALUES
    (0, 'banned', 0, 0, 'Blocked from all access'),
    (1, 'guest', 100, 10, 'Default free tier'),
    (2, 'admin', -1, -1, 'Unlimited access, bypasses all checks');

-- =================================================================
-- USERS TABLE
-- Each unique client_uuid gets one record. role_id determines access.
-- =================================================================
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_uuid TEXT UNIQUE NOT NULL,
    device_fingerprint TEXT NOT NULL,
    role_id INTEGER DEFAULT 1,
    ban_reason TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- =================================================================
-- REQUEST LOG
-- Tracks individual requests for velocity (speed) detection.
-- Cleaned up periodically by scheduled worker.
-- =================================================================
CREATE TABLE request_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- =================================================================
-- DAILY USAGE
-- Tracks daily request count per user for quota enforcement.
-- =================================================================
CREATE TABLE daily_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    usage_date DATE NOT NULL,
    usage_count INTEGER DEFAULT 0,
    last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, usage_date),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- =================================================================
-- INDEXES
-- Critical for query performance.
-- =================================================================
CREATE INDEX IF NOT EXISTS idx_users_uuid ON users(client_uuid);
CREATE INDEX IF NOT EXISTS idx_users_fingerprint ON users(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_logs_user_time ON request_log(user_id, requested_at);
CREATE INDEX IF NOT EXISTS idx_usage_user_date ON daily_usage(user_id, usage_date);