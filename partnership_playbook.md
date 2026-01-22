# Partnership Playbook: Groq & OpenRouter

*Detailed outreach strategy for Snip & Ask Chrome Extension*

---

## When to Reach Out

| Stage | Action |
|-------|--------|
| ❌ Now (pending review) | Don't email — "I have an extension" is weak |
| ✅ After Chrome Store approval | Wait 1-2 days, then email |
| ✅✅ After 50-100 users | Even better — "I have real users" is compelling |

---

## Who to Contact

| Company | Where to Find Them |
|---------|-------------------|
| **Groq** | Twitter/X (@GroqInc), LinkedIn, Discord |
| **OpenRouter** | Twitter (@OpenRouterAI), Discord |

**Pro tip:** Twitter DMs often work better than cold email for startups.

---

## What They Care About

### Groq's Priorities
| Their Goal | How You Help |
|------------|--------------|
| More API usage | Users try Groq through your extension |
| New user acquisition | Guest Mode users → might sign up for own key |
| Real-world testing data | Screenshot → AI queries (unique patterns) |
| Developer ecosystem | Extensions = proof API is developer-friendly |
| Distribution | You put their model in front of new users |

### OpenRouter's Priorities
| Their Goal | How You Help |
|------------|--------------|
| Model comparison data | Compare Mode shows which models "win" |
| Distribution | Their models reach users who wouldn't visit openrouter.ai |
| Free tier stress test | Real usage patterns for free models |

---

## The Value Proposition (What You Offer)

```
User installs your extension
         ↓
Uses Guest Mode (Groq API)
         ↓
Gets fast, good response
         ↓
Thinks "Groq is fast" ← BRAND AWARENESS
         ↓
Maybe signs up for own key ← CONVERSION
         ↓
Maybe tells friends ← WORD OF MOUTH
```

### The Unique Data Your Extension Generates

> "My users generate unique query patterns you don't get from ChatGPT:
> - Homework screenshots
> - Code snippets from tutorials
> - Error messages from random software
> - Quick factual questions
> 
> These are **ephemeral, context-heavy queries** — high signal for vision model improvement."

---

## Strategic Positioning

| To Groq | To OpenRouter |
|---------|---------------|
| "You're the exclusive Guest Mode provider" | "Would love to add you, interested in partnering?" |
| "Users experience your speed first" | "Use Groq exclusivity as leverage" |

**Key insight:** Keep Guest Mode = Groq only for now. This gives you leverage.

---

## Email Template for Groq

**Subject:** Chrome extension driving real usage to Groq

```
Hi [Name],

I'm Saurav, a student developer. I built Snip & Ask, an open-source 
Chrome extension that lets users screenshot anything and get instant 
AI analysis.

It just went live on the Chrome Web Store: [link]

Guest Mode uses Groq as the exclusive default provider — users 
experience your speed without needing their own API keys.

How this helps you:
• Every Guest Mode query = your API being used
• Users who hit rate limits are prompted to get their own Groq key 
  → direct conversion funnel
• You get real-world vision model usage data (screenshot → question patterns)
• Brand awareness: Users think "Groq is fast" without signing up

Current status: Live on Chrome Web Store, open source, [X] installs.

I'd love to explore:
• Featured extension status
• Sponsored credits for Guest Mode
• Co-marketing opportunity

Happy to share analytics. Here's the extension:
• GitHub: [link]
• Chrome Store: [link]

Thanks!
Saurav
```

---

## Email Template for OpenRouter

**Subject:** Adding OpenRouter to Chrome extension (partnership opportunity)

```
Hi,

I built Snip & Ask, an open-source Chrome extension for instant 
screenshot → AI analysis. Currently live on Chrome Web Store.

Guest Mode currently uses Groq exclusively, but I'd love to add 
OpenRouter as an option — especially for your diverse model catalog.

What I'm looking for:
• Sponsored credits for Guest Mode users
• Featured extension status

What you get:
• Distribution to users who wouldn't visit openrouter.ai
• Compare Mode data (users can compare models side-by-side)
• Real-world vision model queries

Currently at [X] installs with [X] daily queries.

Interested in exploring this?

GitHub: [link]
Chrome Store: [link]

— Saurav
```

---

## Guest Mode Data Flow

```
User snips screenshot
        ↓
Your Extension (client-side)
        ↓
Your Cloudflare Worker (rate limiting ONLY)
        ↓
Groq API (processes the image/text)
        ↓
Response back to user
```

### Who Sees What

| Party | What They See | What They Store |
|-------|---------------|-----------------|
| **You (Worker)** | Fingerprint hash, request count | Just rate limit data, NO content |
| **Groq** | The actual prompt + image | Yes, per their terms |
| **User** | Their own snips + answers | Nothing stored after session |

### What to Tell Them About Data

> "I'm not collecting or selling user data. I'm driving real API usage 
> to your platform. Every Guest Mode query is free distribution for you. 
> If you give me credits, I'll drive more."

---

## Decision Tree: OpenRouter in Guest Mode

| Scenario | Action |
|----------|--------|
| OpenRouter offers credits | ✅ Add them to Guest Mode |
| You want to spend your own money | Maybe (if you want variety) |
| Groq has reliability issues | Add OpenRouter as fallback |
| Just because more models | ❌ Don't add — complexity without benefit |

---

## What to Ask For

### From Groq
- ✅ Featured extension status
- ✅ Sponsored API credits for Guest Mode
- ✅ Co-marketing (they tweet about you)
- ✅ Early access to new models

### From OpenRouter
- ✅ Credits for Guest Mode
- ✅ Featured extension status
- ⚠️ Maybe: Direct partnership with model providers

---

## Framing Checklist

| ❌ Don't Say | ✅ Do Say |
|-------------|----------|
| "I'm using your free tier" | "I'm driving users to your platform" |
| "Can I have credits?" | "This is a conversion funnel for you" |
| "Please help me" | "Here's what you gain" |
| "I'm a student project" | "I'm an open-source extension on Chrome Store" |

---

## Pre-Outreach Checklist

- [ ] Chrome Store approved
- [ ] First 50-100 installs
- [ ] Screenshot of Chrome Store listing
- [ ] GitHub repo looks professional
- [ ] Basic usage stats (if possible)
- [ ] Email drafted and reviewed
