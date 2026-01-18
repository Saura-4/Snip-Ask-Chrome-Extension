# Cloudflare Worker - Role-Based Anti-Abuse System

Proxies Groq API requests for Guest Mode with **role-based access control** and **API key rotation**.

## Quick Setup

```bash
# 1. Login
wrangler login

# 2. Initialize/reset schema (WARNING: clears existing data)
wrangler d1 execute snip-ask-guest-db --file=./schema.sql

# 3. Deploy
wrangler deploy
```

## Required Environment Variables

In [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers → Settings → Variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | Yes | Primary Groq key (encrypted) |
| `GROQ_API_KEY_2` | No | Backup key for rotation |
| `GROQ_API_KEY_3` | No | Third backup |
| `ALLOWED_EXTENSION_ID` | Recommended | Your Chrome extension ID |

## Role System

| Role | ID | Daily Limit | Velocity Limit | Description |
|------|----|-------------|----------------|-------------|
| `banned` | 0 | 0 | 0 | Blocked from all access |
| `guest` | 1 | 100 | 10/min | Default for new users |
| `admin` | 2 | Unlimited | Unlimited | Bypass all checks |

### Adding New Roles

```sql
-- Add a new role (no other table changes needed)
INSERT INTO roles (id, name, daily_limit, velocity_limit, description) 
VALUES (3, 'tester', 50, 15, 'Beta testers');
```

## Anti-Abuse Flow

```
Request → Banned? → Admin? → Velocity? → Daily Limit? → LLM API
            ↓         ↓          ↓            ↓
         REJECT    BYPASS    AUTO-BAN      REJECT
```

## Admin Commands

```bash
# View all users with their roles
wrangler d1 execute snip-ask-guest-db --command="SELECT u.id, u.client_uuid, r.name as role, u.created_at FROM users u JOIN roles r ON u.role_id = r.id"

# View banned users
wrangler d1 execute snip-ask-guest-db --command="SELECT * FROM users WHERE role_id = 0"

# Promote a user to admin
wrangler d1 execute snip-ask-guest-db --command="UPDATE users SET role_id = 2 WHERE client_uuid = 'target-uuid'"

# Ban a user
wrangler d1 execute snip-ask-guest-db --command="UPDATE users SET role_id = 0, ban_reason = 'Manual ban' WHERE client_uuid = 'target-uuid'"

# Unban a user (set back to guest)
wrangler d1 execute snip-ask-guest-db --command="UPDATE users SET role_id = 1, ban_reason = NULL WHERE client_uuid = 'target-uuid'"

# View top users today
wrangler d1 execute snip-ask-guest-db --command="SELECT u.client_uuid, d.usage_count FROM daily_usage d JOIN users u ON d.user_id = u.id WHERE d.usage_date = date('now') ORDER BY d.usage_count DESC LIMIT 10"

# View all roles
wrangler d1 execute snip-ask-guest-db --command="SELECT * FROM roles"
```

## Schema Overview

```
roles (lookup table)
  ├── id, name, daily_limit, velocity_limit, description
  │
users (one per client)
  ├── id, client_uuid, device_fingerprint, role_id (FK → roles)
  │
request_log (velocity tracking)
  ├── id, user_id (FK → users), requested_at
  │
daily_usage (quota tracking)
  └── id, user_id (FK → users), usage_date, usage_count
```
