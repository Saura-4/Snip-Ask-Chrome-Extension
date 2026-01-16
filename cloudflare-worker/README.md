# Cloudflare Worker Setup Guide

This folder contains a Cloudflare Worker that proxies Groq API requests for demo users with server-side rate limiting.

## Quick Setup (5 minutes)

### 1. Create Cloudflare Account
- Go to [dash.cloudflare.com](https://dash.cloudflare.com)
- Sign up (free tier is sufficient)

### 2. Create KV Namespace
1. Go to **Workers & Pages** → **KV**
2. Click **Create a namespace**
3. Name it `snip-ask-demo-usage`
4. Copy the **Namespace ID**

### 3. Create Worker
1. Go to **Workers & Pages** → **Create**
2. Click **Create Worker**
3. Name it `snip-ask-demo`
4. Replace the code with contents of `worker.js`
5. Click **Deploy**

### 4. Configure Variables
1. Go to your worker → **Settings** → **Variables**
2. Add **Environment Variables**:
   - `GROQ_API_KEY`: Your Groq API key (click "Encrypt")
   - `DAILY_LIMIT`: `5` (optional)
3. Add **KV Namespace Bindings**:
   - Variable name: `DEMO_USAGE`
   - KV namespace: Select `snip-ask-demo-usage`
4. Click **Save and deploy**

### 5. Get Your Worker URL
Your worker URL will be: `https://snip-ask-demo.YOUR_SUBDOMAIN.workers.dev`

Copy this URL and update `DEMO_WORKER_URL` in the extension's `demo-config.js`.

## Testing

```bash
curl -X POST https://snip-ask-demo.YOUR_SUBDOMAIN.workers.dev \
  -H "Content-Type: application/json" \
  -H "X-Instance-ID: test-12345678" \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"Hello"}]}'
```

## Rotating Your Groq Key

1. Go to [console.groq.com](https://console.groq.com) → Create new key
2. Go to Cloudflare → Worker → Settings → Variables
3. Update `GROQ_API_KEY` with new key
4. Save and deploy (instant, no extension update needed!)
