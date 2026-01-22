# Snip & Ask Improvement Roadmap

## Current Sprint: LLM Response Quality

### [ ] Prompt Engineering Overhaul
- [ ] Rewrite `PROMPTS` in `ai-service.js` with more explicit, task-specific instructions
- [ ] Add format enforcement (force structured output for MCQs, code fixes)
- [ ] Add domain detection hints (code vs. math vs. general text)
- [ ] Test with Llama 3.2 Vision and Gemini Flash

### [ ] Verification/Confidence UI
- [ ] Add a subtle "verify" indicator when model confidence seems low
- [ ] Detect short/uncertain responses and warn user
- [ ] Add "Ask another model" quick button for cross-verification

---

## Partnership Outreach (After Chrome Store Approval)

### [ ] Pre-Outreach Prep
- [ ] Wait for Chrome Store approval
- [ ] Get first 50-100 users
- [ ] Take screenshots of Chrome Store listing
- [ ] Track basic usage stats (installs, queries if possible)

### [ ] Groq Outreach
- [ ] Find DevRel contacts (Twitter, Discord, LinkedIn)
- [ ] Draft value-focused email (you're driving usage to their API)
- [ ] Position: "You're the exclusive Guest Mode provider"
- [ ] Ask: Featured status, sponsored credits, co-marketing

### [ ] OpenRouter Outreach
- [ ] Find contacts (Twitter @OpenRouterAI, Discord)
- [ ] Position: "Would love to add you to Guest Mode with partnership"
- [ ] Ask: Credits for Guest Mode, featured extension status
- [ ] Use Groq exclusivity as leverage

### [ ] General Strategy
- [ ] Keep Guest Mode = Groq only (for now, as leverage)
- [ ] Add OpenRouter only if they provide credits/partnership
- [ ] Frame as mutual value, not a request

---

## Future Improvements (Backlog)

### [ ] Model Quality
- [ ] Add model recommendations per use case (code → Gemini, math → Claude)
- [ ] Smart model fallback when primary fails

### [ ] UX Polish
- [ ] Screenshot quality indicator (warn on low-res snips)
- [ ] Better OCR fallback for non-vision models
- [ ] Response caching for repeated questions

### [ ] Feature Requests
- [ ] PDF Analysis support
- [ ] History sync across devices
- [ ] Custom keyboard shortcuts per mode
