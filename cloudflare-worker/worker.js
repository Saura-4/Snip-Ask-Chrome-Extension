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

            // Fallback limits
            const DEFAULT_VELOCITY_LIMIT = parseInt(env.VELOCITY_LIMIT || '10');
            const DEFAULT_DAILY_LIMIT = parseInt(env.HARD_CAP_DAILY || '100');
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

            if (!isUnlimited) {
                // =================================================================
                // CHECK 3: Velocity (Speed) Detection
                // =================================================================
                const velocityWindow = new Date(Date.now() - VELOCITY_WINDOW_SECONDS * 1000).toISOString();
                const recentEvents = await env.DB.prepare(
                    'SELECT COUNT(*) as count FROM velocity_events WHERE user_id = ? AND requested_at > ?'
                ).bind(userId, velocityWindow).first();

                if (recentEvents?.count >= velocityLimit) {
                    // Auto-ban logic: Ban the fingerprint (so all accounts on this device are banned)
                    await env.DB.prepare(
                        "UPDATE users SET role_id = 'banned', ban_reason = ? WHERE device_fingerprint = ?"
                    ).bind('Automated: Velocity abuse', deviceFingerprint).run();

                    console.log(`AUTO-BAN: Fingerprint ${deviceFingerprint} (User ${userId}) for velocity`);

                    return jsonResponse({
                        error: 'Rate limit exceeded',
                        code: 'VELOCITY_BAN',
                        message: 'Too many requests. Device suspended.'
                    }, 429, corsHeaders);
                }

                // =================================================================
                // CHECK 4: Daily Limit
                // =================================================================
                const usageStat = await env.DB.prepare(
                    'SELECT usage_count FROM usage_stats WHERE user_id = ?'
                ).bind(userId).first();

                const currentUsage = usageStat?.usage_count || 0;
                const incrementBy = parallelCount > 0 ? parallelCount : 1;

                if (dailyLimit !== -1 && currentUsage + incrementBy > dailyLimit) {
                    return jsonResponse({
                        error: 'Daily limit reached',
                        code: 'HARD_CAP',
                        message: 'Daily limit reached. Try again tomorrow.'
                    }, 429, corsHeaders);
                }
            }

            // =================================================================
            // EXECUTION
            // =================================================================

            // Log velocity event
            await env.DB.prepare(
                'INSERT INTO velocity_events (user_id) VALUES (?)'
            ).bind(userId).run();

            // Prepare request body
            const groqBody = { ...body };
            delete groqBody._meta;

            // Get API keys
            const apiKeys = [env.GROQ_API_KEY, env.GROQ_API_KEY_2, env.GROQ_API_KEY_3].filter(Boolean);
            if (apiKeys.length === 0) {
                return jsonResponse({ error: 'No API keys configured', code: 'CONFIG_ERROR' }, 500, corsHeaders);
            }

            let groqResponse = null;

            // Try keys
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
                    if (groqResponse.status !== 429) break;
                } catch (e) {
                    console.log(`Key failed: ${e.message}`);
                }
            }

            if (!groqResponse || groqResponse.status === 429) {
                return jsonResponse({
                    error: 'Service busy',
                    code: 'API_EXHAUSTED',
                    message: 'Please try again later.'
                }, 503, corsHeaders);
            }

            // Update usage stats (if success and not unlimited)
            if (groqResponse.ok && parallelCount > 0 && !isUnlimited) {
                const incrementBy = parallelCount > 0 ? parallelCount : 1;
                // Upsert usage
                await env.DB.prepare(`
                    INSERT INTO usage_stats (user_id, usage_count)
                    VALUES (?, ?)
                    ON CONFLICT(user_id) 
                    DO UPDATE SET usage_count = usage_count + ?
                `).bind(userId, incrementBy, incrementBy).run();
            }

            // Update last seen
            await env.DB.prepare(
                'UPDATE users SET last_seen_at = CURRENT_TIMESTAMP WHERE user_id = ?'
            ).bind(userId).run();

            const responseData = await groqResponse.json();
            return jsonResponse({ ...responseData, _guest: { ok: true } }, groqResponse.status, corsHeaders);

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
                console.log(`Daily reset at IST midnight: Cleared ${usageCleanup.meta?.changes || 0} usage stats`);

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

function jsonResponse(data, status, corsHeaders) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}



