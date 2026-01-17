-- 1. Clean Slate
DROP TABLE IF EXISTS request_log;
DROP TABLE IF EXISTS daily_usage;
DROP TABLE IF EXISTS users;

-- 2. Users Table (Stores the Ban Status)
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_uuid TEXT UNIQUE NOT NULL,
    device_fingerprint TEXT NOT NULL,
    is_banned BOOLEAN DEFAULT 0,       -- Kill Switch
    ban_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Request Log (The "Black Box" for Velocity Checking)
-- We store every hit here to calculate speed
CREATE TABLE request_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_fingerprint TEXT NOT NULL,
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Daily Usage (The Wallet Check)
CREATE TABLE daily_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_fingerprint TEXT NOT NULL,
    usage_date DATE NOT NULL,
    usage_count INTEGER DEFAULT 0,
    last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_fingerprint, usage_date)
);

-- 5. Indexes (Critical for speed)
CREATE INDEX IF NOT EXISTS idx_users_fingerprint ON users(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_logs_fingerprint_time ON request_log(device_fingerprint, requested_at);
CREATE INDEX IF NOT EXISTS idx_usage_fingerprint_date ON daily_usage(device_fingerprint, usage_date);