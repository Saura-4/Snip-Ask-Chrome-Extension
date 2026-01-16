# Cloudflare Worker Setup Guide

This worker proxies Groq API requests for Guest Mode users with **anti-cheat rate limiting** using UUID + device fingerprint tracking.

## Quick Setup (10 minutes)

### Prerequisites
- [Node.js](https://nodejs.org/) installed
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/): `npm install -g wrangler`
- A Cloudflare account (free tier is sufficient)

### 1. Login to Cloudflare
```bash
wrangler login
```

### 2. Create D1 Database
```bash
cd cloudflare-worker
wrangler d1 create snip-ask-guest-db
```

Copy the `database_id` from the output and replace `YOUR_D1_DATABASE_ID` in `wrangler.toml`.

### 3. Initialize Database Schema
```bash
wrangler d1 execute snip-ask-guest-db --file=./schema.sql
```

### 4. Set Environment Variables
In [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers → Your Worker → Settings → Variables:
- Add `GROQ_API_KEY` (encrypted) - Get from [console.groq.com](https://console.groq.com)

### 5. Deploy
```bash
wrangler deploy
```

Your worker URL: `https://snip-ask-guest.YOUR_SUBDOMAIN.workers.dev`

---

## How Anti-Cheat Works

```
Request → Check UUID → Check Fingerprint → Allow/Block
         ↓                ↓
      Registered?     Same device?
         ↓                ↓
      Use quota      Link or reject
```

1. **UUID**: Stored in extension, identifies installation
2. **Fingerprint**: Hardware-based, survives reinstalls
3. **Double check**: Reinstalling extension doesn't reset quota

---

## Testing

```bash
curl -X POST https://snip-ask-guest.YOUR_SUBDOMAIN.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"_meta":{"clientUuid":"test-123","deviceFingerprint":"abc123"},"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"Hello"}]}'
```

## Monitoring Usage

View database entries:
```bash
wrangler d1 execute snip-ask-guest-db --command="SELECT * FROM daily_usage ORDER BY usage_date DESC LIMIT 10"
```

## Rotating Your Groq Key

1. Create new key at [console.groq.com](https://console.groq.com)
2. Update `GROQ_API_KEY` in Cloudflare Dashboard → Worker → Settings → Variables
3. Changes take effect immediately
