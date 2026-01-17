# Cloudflare Worker - Anti-Abuse System

Proxies Groq API requests for Guest Mode with **3-check anti-abuse** and **API key rotation**.

## Quick Setup

```bash
# 1. Login
wrangler login

# 2. Initialize schema (already done if upgrading)
wrangler d1 execute snip-ask-guest-db --file=./schema.sql

# 3. Deploy
wrangler deploy
```

## Add API Keys (Required)

In [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers → Settings → Variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | Yes | Primary Groq key (encrypted) |
| `GROQ_API_KEY_2` | No | Backup key for rotation |
| `GROQ_API_KEY_3` | No | Third backup |

## Anti-Abuse Flow

```
Request → Banned? → Velocity? → Hard Cap? → LLM API
            ↓           ↓           ↓
         REJECT     AUTO-BAN     REJECT
```

- **Velocity**: 10+ requests/minute = auto-ban
- **Hard Cap**: 100 requests/day max

## Admin Commands

```bash
# View banned users
wrangler d1 execute snip-ask-guest-db --command="SELECT * FROM users WHERE is_banned=1"

# Unban a user
wrangler d1 execute snip-ask-guest-db --command="UPDATE users SET is_banned=0 WHERE device_fingerprint='xxx'"

# View top users today
wrangler d1 execute snip-ask-guest-db --command="SELECT * FROM daily_usage WHERE usage_date=date('now') ORDER BY usage_count DESC LIMIT 10"
```
