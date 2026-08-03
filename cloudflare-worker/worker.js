// Snip & Ask Guest Mode - Anti-Abuse Worker with Role-Based Access
// Deploy: wrangler deploy
//
// Apply cloudflare-worker/migrations/0001_guest_rate_limit_hardening.sql to
// existing D1 databases before deploying this version.

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const corsHeaders = buildCorsHeaders(request, env);

        if (request.method === 'OPTIONS') {
            const extensionOriginCheck = validateExtensionOrigin(request, env, { preflight: true });
            if (!extensionOriginCheck.ok) {
                return jsonResponse({
                    error: 'Unauthorized',
                    code: extensionOriginCheck.code
                }, 403, corsHeaders);
            }
            return new Response(null, { headers: corsHeaders });
        }

        if (request.method !== 'POST') {
            return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
        }

        if (url.pathname === '/analytics') {
            return jsonResponse({ error: 'Analytics are disabled', code: 'NOT_FOUND' }, 404, corsHeaders);
        }

        const extensionOriginCheck = validateExtensionOrigin(request, env);
        if (!extensionOriginCheck.ok) {
            return jsonResponse({
                error: 'Unauthorized',
                code: extensionOriginCheck.code
            }, 403, corsHeaders);
        }

        try {
            if (!env.DB) {
                return jsonResponse({ error: 'Database not configured', code: 'CONFIG_ERROR' }, 500, corsHeaders);
            }

            const bodyResult = await readGuestRequestBody(request);
            if (!bodyResult.ok) {
                return jsonResponse({ error: bodyResult.error, code: bodyResult.code }, 400, corsHeaders);
            }
            const body = bodyResult.body;
            const clientUuid = body._meta?.clientUuid;
            const deviceFingerprint = body._meta?.deviceFingerprint;
            const parallelCount = normalizeParallelCount(body._meta?.parallelCount);
            const requestedMode = typeof body._meta?.mode === 'string' ? body._meta.mode : null;

            if (!clientUuid || !deviceFingerprint) {
                return jsonResponse({
                    error: 'Missing client identification',
                    code: 'MISSING_ID'
                }, 400, corsHeaders);
            }

            const ipHash = await getRequestIpHash(request, env);
            if (!ipHash) {
                return jsonResponse({
                    error: 'Rate-limit configuration is incomplete',
                    code: 'CONFIG_ERROR'
                }, 500, corsHeaders);
            }

            // Fallback limits
            const DEFAULT_VELOCITY_LIMIT = parseInt(env.VELOCITY_LIMIT || '10');
            const DEFAULT_DAILY_LIMIT = parseInt(env.HARD_CAP_DAILY || '100');
            const IP_VELOCITY_LIMIT = parsePositiveInteger(env.IP_VELOCITY_LIMIT, 60);
            const IP_DAILY_LIMIT = parsePositiveInteger(env.IP_DAILY_LIMIT, 500);
            const VELOCITY_WINDOW_SECONDS = parseInt(env.VELOCITY_WINDOW || '60');

            // =================================================================
            // STEP 1: Get or create user
            // =================================================================
            let user = await env.DB.prepare(`
                SELECT u.*, r.daily_limit as role_daily, r.velocity_limit as role_velocity
                FROM users u 
                JOIN roles r ON u.role_id = r.id 
                WHERE u.client_uuid = ?
            `).bind(clientUuid).first();

            if (!user) {
                // Create new user (default role is 'guest')
                // Note: We check if fingerprint is already banned implicitly by checking the new user creation? 
                // No, we should check fingerprint ban status FIRST if we want to be strict, but
                // creating the user and THEN checking is okay too, or we can check existing users with this fingerprint.

                // Better approach: Check if any user with this fingerprint is banned first.
                const fingerprintBan = await env.DB.prepare(
                    "SELECT 1 FROM users WHERE device_fingerprint = ? AND role_id = 'banned' LIMIT 1"
                ).bind(deviceFingerprint).first();

                const initialRole = fingerprintBan ? 'banned' : 'guest';

                await env.DB.prepare(
                    'INSERT INTO users (client_uuid, device_fingerprint, role_id) VALUES (?, ?, ?)'
                ).bind(clientUuid, deviceFingerprint, initialRole).run();

                // Fetch again
                user = await env.DB.prepare(`
                    SELECT u.*, r.daily_limit as role_daily, r.velocity_limit as role_velocity
                    FROM users u 
                    JOIN roles r ON u.role_id = r.id 
                    WHERE u.client_uuid = ?
                `).bind(clientUuid).first();
            }

            const userId = user.user_id; // Integer ID
            const roleId = user.role_id; // 'guest', 'admin', 'banned'

            // Resolve Limits (Custom > Role > Default)
            // Note: If role limit is -1, it means unlimited. logic below handles this.
            const dailyLimit = user.custom_daily_limit ?? user.role_daily ?? DEFAULT_DAILY_LIMIT;
            const velocityLimit = user.custom_velocity_limit ?? user.role_velocity ?? DEFAULT_VELOCITY_LIMIT;

            // =================================================================
            // CHECK 1: Ban Check
            // =================================================================
            if (roleId === 'banned') {
                return jsonResponse({
                    error: 'Access denied',
                    code: 'BANNED',
                    message: user.ban_reason || 'This device has been suspended.'
                }, 403, corsHeaders);
            }

            // =================================================================
            // CHECK 2: Admin / Unlimited Check
            // =================================================================
            const isUnlimited = dailyLimit === -1 && velocityLimit === -1;

            let currentUsage = 0;
            const incrementBy = parallelCount > 0 ? parallelCount : 1;

            if (!isUnlimited) {
                // =================================================================
                // CHECK 3: Velocity (Speed) Detection
                // =================================================================
                const velocityWindow = new Date(Date.now() - VELOCITY_WINDOW_SECONDS * 1000).toISOString();
                const recentEvents = await env.DB.prepare(
                    'SELECT COUNT(*) as count FROM velocity_events WHERE user_id = ? AND requested_at > ?'
                ).bind(userId, velocityWindow).first();
                const recentIpEvents = await env.DB.prepare(
                    'SELECT COUNT(*) as count FROM velocity_events WHERE ip_hash = ? AND requested_at > ?'
                ).bind(ipHash, velocityWindow).first();

                if (recentEvents?.count >= velocityLimit || recentIpEvents?.count >= IP_VELOCITY_LIMIT) {
                    return jsonResponse({
                        error: 'Rate limit exceeded',
                        code: 'RATE_LIMITED',
                        message: 'Too many requests. Please wait a minute and try again.'
                    }, 429, corsHeaders);
                }

                // =================================================================
                // CHECK 4: Daily Limit
                // =================================================================
                const usageStat = await env.DB.prepare(
                    'SELECT usage_count FROM usage_stats WHERE user_id = ?'
                ).bind(userId).first();

                currentUsage = usageStat?.usage_count || 0;

                if (dailyLimit !== -1 && currentUsage + incrementBy > dailyLimit) {
                    return jsonResponse({
                        error: 'Daily limit reached',
                        code: 'HARD_CAP',
                        message: 'Daily limit reached. Try again tomorrow.'
                    }, 429, corsHeaders);
                }

                const ipUsage = await env.DB.prepare(
                    'SELECT usage_count FROM ip_usage_stats WHERE ip_hash = ?'
                ).bind(ipHash).first();
                if ((ipUsage?.usage_count || 0) + incrementBy > IP_DAILY_LIMIT) {
                    return jsonResponse({
                        error: 'Guest capacity for this network is exhausted',
                        code: 'NETWORK_DAILY_LIMIT',
                        message: 'Please try again tomorrow or add your own API key.'
                    }, 429, corsHeaders);
                }
            }

            // =================================================================
            // EXECUTION
            // =================================================================

            // Prepare request body
            const groqBody = { ...body };
            delete groqBody._meta;

            // Hotfix: If a client is pinned to a deprecated/removed Groq model, rewrite to a stable fallback.
            // This lets us fix Guest Mode immediately without waiting for a Chrome Web Store update.
            const MODEL_FALLBACKS = {
                'meta-llama/llama-4-maverick-17b-128e-instruct': 'qwen/qwen3.6-27b',
                'meta-llama/llama-4-scout-17b-16e-instruct': 'qwen/qwen3.6-27b',
                'llama-3.1-8b-instant': 'openai/gpt-oss-20b',
                'llama-3.3-70b-versatile': 'openai/gpt-oss-120b'
            };
            if (typeof groqBody.model === 'string' && MODEL_FALLBACKS[groqBody.model]) {
                groqBody.model = MODEL_FALLBACKS[groqBody.model];
            }

            const payloadValidation = validateGuestPayload(groqBody);
            if (!payloadValidation.ok) {
                return jsonResponse({ error: payloadValidation.error, code: payloadValidation.code }, 400, corsHeaders);
            }

            const requestedModel = typeof body._meta?.requestedModel === 'string'
                ? body._meta.requestedModel
                : (typeof groqBody.model === 'string' ? groqBody.model : null);
            const routedModel = typeof groqBody.model === 'string' ? groqBody.model : null;
            const velocityResult = await env.DB.prepare(
                'INSERT INTO velocity_events (user_id, ip_hash, model, mode) VALUES (?, ?, ?, ?) RETURNING id'
            ).bind(userId, ipHash, requestedModel || routedModel, requestedMode).first();
            const velocityEventId = velocityResult?.id;

            // Get API keys
            const apiKeys = [env.GROQ_API_KEY, env.GROQ_API_KEY_2, env.GROQ_API_KEY_3].filter(Boolean);
            if (apiKeys.length === 0) {
                return jsonResponse({ error: 'No API keys configured', code: 'CONFIG_ERROR' }, 500, corsHeaders);
            }

            const AUTO_GUEST_MODEL = 'groq:auto';
            const AUTO_MODEL_CHAIN = [
                'openai/gpt-oss-20b',
                'openai/gpt-oss-120b',
                'qwen/qwen3.6-27b'
            ];
            const VISION_MODEL_CHAIN = ['qwen/qwen3.6-27b'];
            const forceVisionFallback = body._meta?.forceVisionFallback === true;
            const isAutoRequest = requestedModel === AUTO_GUEST_MODEL || groqBody.model === AUTO_GUEST_MODEL;
            const isAutoModel = isAutoRequest || forceVisionFallback;
            const modelChain = forceVisionFallback
                ? VISION_MODEL_CHAIN
                : isAutoRequest
                    ? AUTO_MODEL_CHAIN
                    : [groqBody.model];
            let groqResponse = null;
            let responseData = null;
            let finalModel = null;
            let attemptedModels = [];
            let emptyResponseModels = [];
            let lastAutoFailure = null;

            modelLoop:
            for (const candidateModel of modelChain) {
                if (!candidateModel) continue;
                attemptedModels.push(candidateModel);
                const candidateBody = buildGroqRequestBody(groqBody, candidateModel);

                for (const apiKey of apiKeys) {
                    try {
                        const candidateResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${apiKey}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(candidateBody)
                        });

                        if (candidateResponse.status === 429) {
                            groqResponse = candidateResponse;
                            lastAutoFailure = { model: candidateModel, status: candidateResponse.status, reason: 'rate_limited' };
                            continue;
                        }

                        let candidateData = null;
                        try {
                            candidateData = await candidateResponse.json();
                        } catch (parseError) {
                            lastAutoFailure = { model: candidateModel, status: candidateResponse.status, reason: 'invalid_json' };
                            console.log(`Auto model ${candidateModel} returned invalid JSON: ${parseError.message}`);
                            continue;
                        }

                        if (!candidateResponse.ok) {
                            lastAutoFailure = { model: candidateModel, status: candidateResponse.status, reason: 'http_error' };
                            console.log(`Auto model ${candidateModel} returned HTTP ${candidateResponse.status}; trying next key.`);
                            continue;
                        }

                        if (!hasUsableAssistantContent(candidateData)) {
                            if (!isAutoModel) {
                                return jsonResponse({
                                    error: 'The selected model returned no final answer. Please try again.',
                                    code: 'EMPTY_MODEL_RESPONSE',
                                    model: candidateModel
                                }, 502, corsHeaders);
                            }
                            emptyResponseModels.push(candidateModel);
                            lastAutoFailure = { model: candidateModel, status: candidateResponse.status, reason: 'empty_answer' };
                            console.log(`Auto model ${candidateModel} returned no usable answer; trying next model.`);
                            break;
                        }

                        groqResponse = candidateResponse;
                        responseData = candidateData;
                        finalModel = candidateModel;
                        break modelLoop;
                    } catch (e) {
                        console.log(`Key failed for ${candidateModel}: ${e.message}`);
                        lastAutoFailure = { model: candidateModel, reason: 'network_error' };
                    }
                }
            }

            if (!finalModel) {
                if (!isAutoModel) {
                    return jsonResponse({
                        error: 'Selected model rate limit reached. Switch to Auto or choose another model.',
                        code: 'MODEL_RATE_LIMITED',
                        message: 'Selected model rate limit reached. Switch to Auto or choose another model.'
                    }, 429, corsHeaders);
                }

                return jsonResponse({
                    error: 'Service busy',
                    code: lastAutoFailure?.reason === 'empty_answer' ? 'AUTO_EMPTY_RESPONSE' : 'API_EXHAUSTED',
                    message: lastAutoFailure?.reason === 'empty_answer'
                        ? 'Auto models did not return a usable answer. Please try again.'
                        : 'All Auto guest models are currently unavailable. Please try again later.',
                    attemptedModels,
                    emptyResponseModels
                }, 503, corsHeaders);
            }

            // NOTE: Usage stats (including token count) are now updated after API response below

            // Update last seen
            await env.DB.prepare(
                'UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE user_id = ?'
            ).bind(userId).run();

            if (!responseData) {
                responseData = await groqResponse.json();
            }

            // Extract token usage from Groq response
            const tokenUsage = responseData.usage?.total_tokens || 0;

            // Update velocity event with token count and the final routed model.
            if (velocityEventId) {
                await env.DB.prepare(
                    'UPDATE velocity_events SET tokens = ?, model = ? WHERE id = ?'
                ).bind(tokenUsage || 0, finalModel || routedModel, velocityEventId).run();
            }

            // Update usage stats for ALL users (including admins) with token tracking
            if (groqResponse.ok) {
                // Upsert usage with token count
                await env.DB.prepare(`
                    INSERT INTO usage_stats (user_id, usage_count, token_count)
                    VALUES (?, ?, ?)
                    ON CONFLICT(user_id) 
                    DO UPDATE SET usage_count = usage_count + ?, token_count = token_count + ?
                `).bind(userId, incrementBy, tokenUsage, incrementBy, tokenUsage).run();
                await env.DB.prepare(`
                    INSERT INTO ip_usage_stats (ip_hash, usage_count)
                    VALUES (?, ?)
                    ON CONFLICT(ip_hash)
                    DO UPDATE SET usage_count = usage_count + ?
                `).bind(ipHash, incrementBy, incrementBy).run();
            }

            return jsonResponse({
                ...responseData,
                _guest: {
                    ok: true,
                    usage: currentUsage + (parallelCount > 0 ? parallelCount : 1),
                    model: finalModel || responseData.model || routedModel,
                    requestedModel,
                    auto: isAutoModel,
                    attemptedModels,
                    emptyResponseModels
                },
                _demo: {
                    ok: true,
                    usage: currentUsage + (parallelCount > 0 ? parallelCount : 1),
                    model: finalModel || responseData.model || routedModel,
                    requestedModel,
                    auto: isAutoModel,
                    attemptedModels,
                    emptyResponseModels
                }
            }, groqResponse.status, corsHeaders);

        } catch (error) {
            console.error('Worker error:', error);
            return jsonResponse({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500, corsHeaders);
        }
    },

    // Scheduled Cleanup Handler - MUST be inside default export
    // Cron runs at :30 past each hour: "30 * * * *"
    // IST = UTC + 5:30, so midnight IST (00:00) = 18:30 UTC
    async scheduled(event, env, ctx) {
        try {
            const now = new Date();
            const utcHours = now.getUTCHours();
            const utcMinutes = now.getUTCMinutes();

            // IST offset is +5:30 (330 minutes)
            const istOffset = 330; // minutes
            const istTime = new Date(now.getTime() + istOffset * 60 * 1000);
            const istHours = istTime.getUTCHours();

            console.log(`Scheduled cleanup running. UTC: ${utcHours}:${utcMinutes}, IST Hour: ${istHours}`);

            // 1. Hourly: Clean velocity events older than 1 hour
            const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
            const velocityCleanup = await env.DB.prepare(
                'DELETE FROM velocity_events WHERE requested_at < ?'
            ).bind(oneHourAgo).run();
            console.log(`Velocity cleanup: Deleted ${velocityCleanup.meta?.changes || 0} old events`);

            // 2. Daily Reset at midnight IST (when IST hour is 0)
            // This triggers when UTC is 18:30 (IST midnight)
            if (istHours === 0) {
                // Clear daily usage stats
                const usageCleanup = await env.DB.prepare('DELETE FROM usage_stats').run();
                const ipUsageCleanup = await env.DB.prepare('DELETE FROM ip_usage_stats').run();
                console.log(`Daily reset at IST midnight: Cleared ${usageCleanup.meta?.changes || 0} usage stats`);
                console.log(`Daily reset at IST midnight: Cleared ${ipUsageCleanup.meta?.changes || 0} network usage stats`);

                // Also clear all velocity events for a fresh start each day
                const velocityDailyCleanup = await env.DB.prepare('DELETE FROM velocity_events').run();
                console.log(`Daily reset: Cleared ${velocityDailyCleanup.meta?.changes || 0} velocity events`);
            }

            console.log('Cleanup completed successfully');
        } catch (error) {
            console.error('Scheduled cleanup error:', error.message, error.stack);
            throw error; // Re-throw so Cloudflare logs the error
        }
    }
};

function extractAssistantText(content) {
    if (!content) return '';
    if (typeof content === 'string') return content;

    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (part?.type === 'text' && typeof part.text === 'string') return part.text;
                if (typeof part?.content === 'string') return part.content;
                if (typeof part?.message === 'string') return part.message;
                return '';
            })
            .filter(Boolean)
            .join('\n')
            .trim();
    }

    if (typeof content === 'object') {
        if (typeof content.text === 'string') return content.text;
        if (typeof content.content === 'string') return content.content;
        if (typeof content.message === 'string') return content.message;
        if (Array.isArray(content.content)) return extractAssistantText(content.content);
    }

    return '';
}

function getCleanAssistantText(responseData) {
    const content = responseData?.choices?.[0]?.message?.content;
    return extractAssistantText(content).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function hasUsableAssistantContent(responseData) {
    const text = getCleanAssistantText(responseData);
    if (!/[\p{L}\p{N}]/u.test(text)) return false;

    const normalized = text.toLowerCase();
    return normalized !== 'no answer returned.' && normalized !== 'no answer.';
}

function jsonResponse(data, status, corsHeaders) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}

function buildCorsHeaders(request, env) {
    const allowedIds = getAllowedExtensionIds(env);
    if (allowedIds.length === 0) {
        return {
            'Access-Control-Allow-Origin': 'null',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Extension-Id',
            'Vary': 'Origin'
        };
    }

    const allowedOrigins = getAllowedExtensionOrigins(env);
    const requestOrigin = request.headers.get('Origin');
    const allowOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];

    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Extension-Id',
        'Vary': 'Origin'
    };
}

function buildGroqRequestBody(body, model) {
    const requestBody = {
        ...body,
        model,
        max_completion_tokens: body.max_completion_tokens || body.max_tokens
    };
    delete requestBody.max_tokens;

    if (typeof model === 'string' && model.toLowerCase().includes('qwen3.6-27b')) {
        requestBody.temperature = 0.7;
        requestBody.reasoning_effort = 'none';
        requestBody.reasoning_format = 'hidden';
        // Qwen 3.6 performs hidden reasoning that consumes the completion budget.
        // Enforce a minimum so the model has room to produce a final answer.
        if (requestBody.max_completion_tokens < 1024) {
            requestBody.max_completion_tokens = 1024;
        }
    }

    return requestBody;
}

const MAX_GUEST_REQUEST_BYTES = 700 * 1024;
const MAX_GUEST_MESSAGES = 20;
const MAX_GUEST_TEXT_CHARS = 60_000;
const MAX_GUEST_IMAGES = 4;
const MAX_GUEST_IMAGE_CHARS = 700_000;
const GUEST_MODEL_ALLOWLIST = new Set([
    'groq:auto',
    'openai/gpt-oss-20b',
    'openai/gpt-oss-120b',
    'qwen/qwen3.6-27b',
    'groq/compound-mini',
    'groq/compound'
]);

async function readGuestRequestBody(request) {
    const declaredLength = Number(request.headers.get('Content-Length') || 0);
    if (declaredLength > MAX_GUEST_REQUEST_BYTES) {
        return { ok: false, code: 'REQUEST_TOO_LARGE', error: 'Guest request is too large.' };
    }

    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_GUEST_REQUEST_BYTES) {
        return { ok: false, code: 'REQUEST_TOO_LARGE', error: 'Guest request is too large.' };
    }

    try {
        return { ok: true, body: JSON.parse(raw) };
    } catch {
        return { ok: false, code: 'INVALID_JSON', error: 'Request body must be valid JSON.' };
    }
}

function normalizeParallelCount(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4 ? parsed : 1;
}

function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function validateGuestPayload(body) {
    if (!body || typeof body !== 'object' || !GUEST_MODEL_ALLOWLIST.has(body.model)) {
        return { ok: false, code: 'UNSUPPORTED_MODEL', error: 'The requested guest model is not available.' };
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_GUEST_MESSAGES) {
        return { ok: false, code: 'INVALID_MESSAGES', error: 'Guest requests must contain between 1 and 20 messages.' };
    }
    if (!Number.isFinite(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 2048) {
        return { ok: false, code: 'INVALID_MAX_TOKENS', error: 'Invalid guest output-token limit.' };
    }
    if (body.temperature !== undefined && (!Number.isFinite(body.temperature) || body.temperature < 0 || body.temperature > 1)) {
        return { ok: false, code: 'INVALID_TEMPERATURE', error: 'Invalid guest temperature.' };
    }

    let textChars = 0;
    let imageCount = 0;
    for (const message of body.messages) {
        if (!message || !['system', 'user', 'assistant'].includes(message.role)) {
            return { ok: false, code: 'INVALID_MESSAGES', error: 'Guest messages have an invalid role.' };
        }
        const parts = Array.isArray(message.content) ? message.content : [message.content];
        for (const part of parts) {
            const text = typeof part === 'string' ? part : part?.type === 'text' ? part.text : null;
            if (typeof text === 'string') {
                textChars += text.length;
                continue;
            }
            const imageUrl = part?.type === 'image_url' ? part.image_url?.url : null;
            if (typeof imageUrl === 'string' && imageUrl.startsWith('data:image/')) {
                imageCount += 1;
                if (imageUrl.length > MAX_GUEST_IMAGE_CHARS) {
                    return { ok: false, code: 'REQUEST_TOO_LARGE', error: 'Guest image is too large.' };
                }
                continue;
            }
            return { ok: false, code: 'INVALID_MESSAGES', error: 'Guest message content is invalid.' };
        }
    }

    if (textChars > MAX_GUEST_TEXT_CHARS || imageCount > MAX_GUEST_IMAGES) {
        return { ok: false, code: 'REQUEST_TOO_LARGE', error: 'Guest request exceeds content limits.' };
    }
    return { ok: true };
}

async function getRequestIpHash(request, env) {
    const ip = request.headers.get('CF-Connecting-IP');
    const secret = env.RATE_LIMIT_HMAC_KEY;
    if (!ip || !secret) return null;

    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip));
    return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function getAllowedExtensionIds(env) {
    const rawIds = env.ALLOWED_EXTENSION_IDS || env.ALLOWED_EXTENSION_ID || '';
    return rawIds
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
}

function getAllowedExtensionOrigins(env) {
    return getAllowedExtensionIds(env).map((id) => `chrome-extension://${id}`);
}

function isChromeExtensionOrigin(origin) {
    return typeof origin === 'string' && origin.startsWith('chrome-extension://');
}

function validateExtensionOrigin(request, env, options = {}) {
    const { preflight = false } = options;
    const allowedIds = getAllowedExtensionIds(env);
    if (allowedIds.length === 0) {
        return { ok: false, code: 'MISSING_EXTENSION_ALLOWLIST' };
    }

    const allowedOrigins = getAllowedExtensionOrigins(env);
    const origin = request.headers.get('Origin');
    const providedExtId = request.headers.get('X-Extension-Id');

    if (preflight) {
        if (!allowedOrigins.includes(origin)) {
            return { ok: false, code: 'INVALID_ORIGIN' };
        }
        return { ok: true };
    }

    if (!allowedIds.includes(providedExtId)) {
        return { ok: false, code: 'INVALID_EXTENSION_ID' };
    }

    // Some Chrome extension fetch contexts do not send Origin on the actual POST.
    // If Origin is present, it must match the allowlist; if it's absent, rely on the
    // explicit extension header plus preflight/CORS enforcement for browser requests.
    if (origin && !allowedOrigins.includes(origin)) {
        return { ok: false, code: 'INVALID_ORIGIN' };
    }

    return { ok: true };
}

export {
    GUEST_MODEL_ALLOWLIST,
    buildGroqRequestBody,
    normalizeParallelCount,
    validateGuestPayload
};



