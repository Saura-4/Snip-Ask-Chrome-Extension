// Snip & Ask Guest Mode - Anti-Abuse Worker with Role-Based Access
// Deploy: wrangler deploy

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

        // Origin validation via Extension ID
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

            // Fallback limits (used if roles table query fails)
            const DEFAULT_VELOCITY_LIMIT = parseInt(env.VELOCITY_LIMIT || '10');
            const DEFAULT_DAILY_LIMIT = parseInt(env.HARD_CAP_DAILY || '100');
            const VELOCITY_WINDOW_SECONDS = parseInt(env.VELOCITY_WINDOW || '60');

            // =================================================================
            // STEP 0: Check if fingerprint is banned (BEFORE anything else)
            // This runs for EVERY request to catch reinstalls/new UUIDs
            // =================================================================
            const bannedByFingerprint = await env.DB.prepare(`
                SELECT u.ban_reason 
                FROM users u 
                JOIN roles r ON u.role_id = r.id 
                WHERE u.device_fingerprint = ? AND r.name = 'banned'
                LIMIT 1
            `).bind(deviceFingerprint).first();

            if (bannedByFingerprint) {
                return jsonResponse({
                    error: 'Access denied',
                    code: 'BANNED',
                    message: bannedByFingerprint.ban_reason || 'This device has been suspended.'
                }, 403, corsHeaders);
            }

            // =================================================================
            // STEP 1: Get or create user with role info
            // =================================================================
            let user = await env.DB.prepare(`
                SELECT u.*, r.name as role_name, r.daily_limit, r.velocity_limit 
                FROM users u 
                JOIN roles r ON u.role_id = r.id 
                WHERE u.client_uuid = ?
            `).bind(clientUuid).first();

            if (!user) {
                // Create new user with default guest role (id = 1)
                await env.DB.prepare(
                    'INSERT INTO users (client_uuid, device_fingerprint, role_id) VALUES (?, ?, 1)'
                ).bind(clientUuid, deviceFingerprint).run();

                // Fetch the newly created user with role info
                user = await env.DB.prepare(`
                    SELECT u.*, r.name as role_name, r.daily_limit, r.velocity_limit 
                    FROM users u 
                    JOIN roles r ON u.role_id = r.id 
                    WHERE u.client_uuid = ?
                `).bind(clientUuid).first();
            }

            const userId = user.id;
            const roleName = user.role_name;
            const dailyLimit = user.daily_limit ?? DEFAULT_DAILY_LIMIT;
            const velocityLimit = user.velocity_limit ?? DEFAULT_VELOCITY_LIMIT;

            // =================================================================
            // CHECK 1: Role-based ban check
            // =================================================================
            if (roleName === 'banned') {
                return jsonResponse({
                    error: 'Access denied',
                    code: 'BANNED',
                    message: user.ban_reason || 'This account has been suspended.'
                }, 403, corsHeaders);
            }

            // =================================================================
            // CHECK 2: Skip limits for admin role
            // =================================================================
            const isAdmin = dailyLimit === -1 && velocityLimit === -1;

            if (!isAdmin) {
                // =================================================================
                // CHECK 3: Velocity (Speed) Detection
                // =================================================================
                const velocityWindow = new Date(Date.now() - VELOCITY_WINDOW_SECONDS * 1000).toISOString();
                const recentRequests = await env.DB.prepare(
                    'SELECT COUNT(*) as count FROM request_log WHERE user_id = ? AND requested_at > ?'
                ).bind(userId, velocityWindow).first();

                if (recentRequests?.count >= velocityLimit) {
                    // Auto-ban for velocity abuse
                    await env.DB.prepare(
                        'UPDATE users SET role_id = 0, ban_reason = ? WHERE id = ?'
                    ).bind('Automated: Too many requests per minute', userId).run();

                    console.log(`AUTO-BAN: User ${userId} for velocity abuse`);

                    return jsonResponse({
                        error: 'Rate limit exceeded',
                        code: 'VELOCITY_BAN',
                        message: 'Too many requests. Please slow down.'
                    }, 429, corsHeaders);
                }

                // =================================================================
                // CHECK 4: Daily Limit
                // =================================================================
                const today = new Date().toISOString().split('T')[0];
                const dailyUsage = await env.DB.prepare(
                    'SELECT usage_count FROM daily_usage WHERE user_id = ? AND usage_date = ?'
                ).bind(userId, today).first();

                const currentUsage = dailyUsage?.usage_count || 0;
                const incrementBy = parallelCount > 0 ? parallelCount : 1;

                if (currentUsage + incrementBy > dailyLimit) {
                    return jsonResponse({
                        error: 'Daily limit reached',
                        code: 'HARD_CAP',
                        message: 'You\'ve reached the daily limit. Please try again tomorrow or get your own free API key at console.groq.com!'
                    }, 429, corsHeaders);
                }
            }

            // =================================================================
            // EXECUTION: Call LLM API with Key Rotation
            // =================================================================

            // Log this request for velocity tracking
            await env.DB.prepare(
                'INSERT INTO request_log (user_id) VALUES (?)'
            ).bind(userId).run();

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

            // Update usage on success (skip for admin)
            if (groqResponse.ok && parallelCount > 0 && !isAdmin) {
                const today = new Date().toISOString().split('T')[0];
                const incrementBy = parallelCount > 0 ? parallelCount : 1;

                await env.DB.prepare(`
                    INSERT INTO daily_usage (user_id, usage_date, usage_count)
                    VALUES (?, ?, ?)
                    ON CONFLICT(user_id, usage_date) 
                    DO UPDATE SET usage_count = usage_count + ?
                `).bind(userId, today, incrementBy, incrementBy).run();
            }

            // Update last seen
            await env.DB.prepare(
                'UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?'
            ).bind(userId).run();

            const responseData = await groqResponse.json();

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
    const cutoff = new Date(Date.now() - 3600 * 1000).toISOString();
    await env.DB.prepare(
        'DELETE FROM request_log WHERE requested_at < ?'
    ).bind(cutoff).run();

    console.log('Cleaned up old request logs');
}
