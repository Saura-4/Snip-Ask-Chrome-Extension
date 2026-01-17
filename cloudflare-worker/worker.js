// Snip & Ask Guest Mode - Anti-Abuse Worker with API Key Rotation
// Deploy: wrangler deploy
//
// SECURITY: Never log API keys or secrets! Keep console.log statements generic.

export default {
    async fetch(request, env) {
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Extension-Id',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        if (request.method !== 'POST') {
            return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
        }

        // =================================================================
        // SECURITY: Origin Validation via Extension ID
        // After publishing your extension, set ALLOWED_EXTENSION_ID in
        // Cloudflare Dashboard > Workers > Settings > Variables
        // to your Chrome extension ID (e.g., "abcdefghijklmnopqrstuvwxyz123456")
        // =================================================================
        if (env.ALLOWED_EXTENSION_ID) {
            const providedExtId = request.headers.get('X-Extension-Id');
            if (providedExtId !== env.ALLOWED_EXTENSION_ID) {
                return jsonResponse({
                    error: 'Unauthorized',
                    code: 'INVALID_ORIGIN'
                }, 403, corsHeaders);
            }
        }

        try {
            if (!env.DB) {
                return jsonResponse({ error: 'Database not configured', code: 'CONFIG_ERROR' }, 500, corsHeaders);
            }

            const body = await request.json();
            const clientUuid = body._meta?.clientUuid;
            const deviceFingerprint = body._meta?.deviceFingerprint;
            const parallelCount = body._meta?.parallelCount ?? 1;

            if (!clientUuid || !deviceFingerprint) {
                return jsonResponse({
                    error: 'Missing client identification',
                    code: 'MISSING_ID'
                }, 400, corsHeaders);
            }

            // Configuration
            const VELOCITY_LIMIT = parseInt(env.VELOCITY_LIMIT || '10');
            const VELOCITY_WINDOW_SECONDS = parseInt(env.VELOCITY_WINDOW || '60');
            const HARD_CAP_DAILY = parseInt(env.HARD_CAP_DAILY || '100');

            // =================================================================
            // STEP 0: Ensure user exists, get or create
            // =================================================================
            let user = await env.DB.prepare(
                'SELECT * FROM users WHERE client_uuid = ?'
            ).bind(clientUuid).first();

            if (!user) {
                // Check if fingerprint already has a user (different UUID, same device)
                const existingByFingerprint = await env.DB.prepare(
                    'SELECT * FROM users WHERE device_fingerprint = ? LIMIT 1'
                ).bind(deviceFingerprint).first();

                if (existingByFingerprint?.is_banned) {
                    // Device is banned under different UUID
                    return jsonResponse({
                        error: 'Access denied',
                        code: 'BANNED',
                        message: existingByFingerprint.ban_reason || 'This device has been suspended.'
                    }, 403, corsHeaders);
                }

                // Create new user
                await env.DB.prepare(
                    'INSERT INTO users (client_uuid, device_fingerprint) VALUES (?, ?)'
                ).bind(clientUuid, deviceFingerprint).run();

                user = { client_uuid: clientUuid, device_fingerprint: deviceFingerprint, is_banned: 0 };
            }

            const fingerprint = user.device_fingerprint;

            // =================================================================
            // CHECK 1: Global Ban
            // =================================================================
            if (user.is_banned) {
                return jsonResponse({
                    error: 'Access denied',
                    code: 'BANNED',
                    message: user.ban_reason || 'This account has been suspended.'
                }, 403, corsHeaders);
            }

            // =================================================================
            // CHECK 2: Velocity (Speed) Detection
            // =================================================================
            const velocityWindow = new Date(Date.now() - VELOCITY_WINDOW_SECONDS * 1000).toISOString();
            const recentRequests = await env.DB.prepare(
                'SELECT COUNT(*) as count FROM request_log WHERE device_fingerprint = ? AND requested_at > ?'
            ).bind(fingerprint, velocityWindow).first();

            if (recentRequests?.count >= VELOCITY_LIMIT) {
                // AUTO-BAN for velocity abuse
                await env.DB.prepare(
                    'UPDATE users SET is_banned = 1, ban_reason = ? WHERE device_fingerprint = ?'
                ).bind('Automated: Too many requests per minute', fingerprint).run();

                console.log(`AUTO-BAN: ${fingerprint.substring(0, 8)}... for velocity abuse`);

                return jsonResponse({
                    error: 'Rate limit exceeded',
                    code: 'VELOCITY_BAN',
                    message: 'Too many requests. Please slow down.'
                }, 429, corsHeaders);
            }

            // =================================================================
            // CHECK 3: Hard Cap (Daily Limit for Wallet Safety)
            // =================================================================
            const today = new Date().toISOString().split('T')[0];
            const dailyUsage = await env.DB.prepare(
                'SELECT usage_count FROM daily_usage WHERE device_fingerprint = ? AND usage_date = ?'
            ).bind(fingerprint, today).first();

            const currentUsage = dailyUsage?.usage_count || 0;
            const incrementBy = parallelCount > 0 ? parallelCount : 1;

            if (currentUsage + incrementBy > HARD_CAP_DAILY) {
                return jsonResponse({
                    error: 'Daily limit reached',
                    code: 'HARD_CAP',
                    message: 'You\'ve reached the daily limit. Please try again tomorrow or get your own free API key at console.groq.com!'
                }, 429, corsHeaders);
            }

            // =================================================================
            // EXECUTION: Call LLM API with Key Rotation
            // =================================================================

            // Log this request for velocity tracking
            await env.DB.prepare(
                'INSERT INTO request_log (device_fingerprint) VALUES (?)'
            ).bind(fingerprint).run();

            // Prepare request body (remove _meta)
            const groqBody = { ...body };
            delete groqBody._meta;

            // Get all available API keys
            const apiKeys = [
                env.GROQ_API_KEY,
                env.GROQ_API_KEY_2,
                env.GROQ_API_KEY_3
            ].filter(Boolean);

            if (apiKeys.length === 0) {
                return jsonResponse({ error: 'No API keys configured', code: 'CONFIG_ERROR' }, 500, corsHeaders);
            }

            let lastError = null;
            let groqResponse = null;

            // Try each key until one works
            for (const apiKey of apiKeys) {
                try {
                    groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(groqBody)
                    });

                    // If not rate limited, use this response
                    if (groqResponse.status !== 429) {
                        break;
                    }

                    console.log(`API key exhausted, trying next...`);
                    lastError = 'API rate limit';
                } catch (e) {
                    lastError = e.message;
                    console.log(`API key failed: ${e.message}, trying next...`);
                }
            }

            if (!groqResponse || groqResponse.status === 429) {
                return jsonResponse({
                    error: 'Service temporarily unavailable',
                    code: 'API_EXHAUSTED',
                    message: 'All servers are busy. Please try again in a few minutes.'
                }, 503, corsHeaders);
            }

            // Update usage on success
            if (groqResponse.ok && parallelCount > 0) {
                await env.DB.prepare(`
                    INSERT INTO daily_usage (device_fingerprint, usage_date, usage_count)
                    VALUES (?, ?, ?)
                    ON CONFLICT(device_fingerprint, usage_date) 
                    DO UPDATE SET usage_count = usage_count + ?
                `).bind(fingerprint, today, incrementBy, incrementBy).run();

                // Update last seen
                await env.DB.prepare(
                    'UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE device_fingerprint = ?'
                ).bind(fingerprint).run();
            }

            const responseData = await groqResponse.json();

            // Add minimal metadata (no limits shown to user)
            return jsonResponse({
                ...responseData,
                _guest: { ok: true }
            }, groqResponse.status, corsHeaders);

        } catch (error) {
            console.error('Worker error:', error);
            return jsonResponse({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500, corsHeaders);
        }
    }
};

function jsonResponse(data, status, corsHeaders) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}

// Cleanup old request logs (run periodically via cron trigger)
export async function scheduled(event, env, ctx) {
    // Delete request logs older than 1 hour
    const cutoff = new Date(Date.now() - 3600 * 1000).toISOString();
    await env.DB.prepare(
        'DELETE FROM request_log WHERE requested_at < ?'
    ).bind(cutoff).run();

    console.log('Cleaned up old request logs');
}
