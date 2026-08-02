# Snip & Ask Guest Worker

The Worker proxies bounded Guest Mode requests to Groq. It rotates configured Groq keys and applies per-installation, per-device, and per-network limits. It does not provide strong authentication: extension IDs and browser fingerprints are client-visible signals, so production deployments should also enable Cloudflare WAF/rate-limit rules.

## New database

Create a new D1 database, set its binding in `wrangler.toml`, then apply the bootstrap schema:

```bash
wrangler d1 execute snip-ask-guest-db --remote --file=./schema.sql
wrangler deploy
```

The bootstrap schema is non-destructive. Do not use it as an upgrade procedure for an existing database.

## Existing database upgrade

Before deploying this Worker version, apply the one-time migration exactly once:

```bash
wrangler d1 execute snip-ask-guest-db --remote --file=./migrations/0001_guest_rate_limit_hardening.sql
```

The migration adds token accounting and keyed network-rate-limit storage. Record its execution in your release log; SQLite `ADD COLUMN` migrations cannot safely be rerun.

## Required configuration

Set these in the Cloudflare dashboard or with Wrangler secrets:

| Variable | Required | Description |
| --- | --- | --- |
| `GROQ_API_KEY` | Yes | Primary Groq key; store as a secret. |
| `RATE_LIMIT_HMAC_KEY` | Yes | Random secret used to HMAC the Cloudflare-supplied client IP. |
| `ALLOWED_EXTENSION_IDS` | Yes | Comma-separated Chrome extension IDs allowed to call Guest Mode. |
| `GROQ_API_KEY_2`, `GROQ_API_KEY_3` | No | Backup Groq keys for rotation. |
| `VELOCITY_LIMIT` | No | Per-installation requests per minute; default `10`. |
| `HARD_CAP_DAILY` | No | Per-installation daily requests; default `100`. |
| `IP_VELOCITY_LIMIT` | No | Per-network requests per minute; default `60`. |
| `IP_DAILY_LIMIT` | No | Per-network daily requests; default `500`. |

Example secret setup:

```bash
wrangler secret put GROQ_API_KEY
wrangler secret put RATE_LIMIT_HMAC_KEY
```

## Operational notes

- Velocity events are retained for one hour; daily counters reset at midnight IST.
- The Worker accepts only its configured Guest Mode model allowlist, a maximum of 20 messages, four images, 700 KiB requests, and 2,048 output tokens.
- `/analytics` and `/analytics/summary` are disabled. The D1 schema contains rate-limit data only.
- Use Cloudflare WAF/rate-limit rules as a second layer against non-browser clients and distributed abuse.
