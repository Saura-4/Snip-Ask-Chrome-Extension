// Snip & Ask Guest Mode - Cloudflare Worker with D1 Anti-Cheat
// Deploy: wrangler deploy

export default {
    async fetch(request, env) {
        // CORS headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        // Handle preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // Only allow POST
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), {
                status: 405,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        try {
            // Check D1 database is bound
            if (!env.DB) {
                console.error('D1 database not bound!');
                return new Response(JSON.stringify({
                    error: 'Server configuration error',
                    code: 'CONFIG_ERROR'
                }), {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // Parse request body
            const body = await request.json();

            // Extract client identifiers
            const clientUuid = body._meta?.clientUuid;
            const deviceFingerprint = body._meta?.deviceFingerprint;
            const parallelCount = body._meta?.parallelCount ?? 1;
            const shouldCount = parallelCount > 0;
            const incrementBy = shouldCount ? parallelCount : 0;

            // Validate required identifiers
            if (!clientUuid || !deviceFingerprint) {
                return new Response(JSON.stringify({
                    error: 'Missing client identification',
                    code: 'MISSING_ID',
                    message: 'Please update your extension to the latest version.'
                }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const today = new Date().toISOString().split('T')[0];
            const dailyLimit = parseInt(env.DAILY_LIMIT || '15');

            // =========================================================
            // STEP A: Check if client_uuid exists in database
            // =========================================================
            const existingUser = await env.DB.prepare(
                'SELECT * FROM users WHERE client_uuid = ?'
            ).bind(clientUuid).first();

            let currentUsage = 0;
            let userFingerprint = deviceFingerprint;

            if (existingUser) {
                // User exists - use their registered fingerprint
                userFingerprint = existingUser.device_fingerprint;

                // Get current usage for this fingerprint
                const usageRecord = await env.DB.prepare(
                    'SELECT usage_count FROM daily_usage WHERE device_fingerprint = ? AND usage_date = ?'
                ).bind(userFingerprint, today).first();

                currentUsage = usageRecord?.usage_count || 0;

                console.log(`Existing user: ${clientUuid.substring(0, 8)}..., Usage: ${currentUsage}/${dailyLimit}`);
            } else {
                // =========================================================
                // STEP B: New UUID - Check if fingerprint is in database
                // =========================================================
                const fingerprintUsage = await env.DB.prepare(
                    'SELECT usage_count FROM daily_usage WHERE device_fingerprint = ? AND usage_date = ?'
                ).bind(deviceFingerprint, today).first();

                currentUsage = fingerprintUsage?.usage_count || 0;

                // =========================================================
                // STEP C: Check if fingerprint has exceeded limit
                // =========================================================
                const requiredQuota = shouldCount ? parallelCount : 1;
                if (currentUsage + requiredQuota > dailyLimit) {
                    console.log(`Device limit exceeded for fingerprint: ${deviceFingerprint.substring(0, 8)}...`);
                    return new Response(JSON.stringify({
                        error: 'Device limit reached',
                        code: 'DEVICE_LIMIT_EXCEEDED',
                        usage: currentUsage,
                        limit: dailyLimit,
                        message: 'This device has reached its daily limit. Get your own free API key at console.groq.com for unlimited use!'
                    }), {
                        status: 429,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                // =========================================================
                // STEP D: Clean fingerprint - Create new user
                // =========================================================
                await env.DB.prepare(
                    'INSERT INTO users (client_uuid, device_fingerprint) VALUES (?, ?)'
                ).bind(clientUuid, deviceFingerprint).run();

                console.log(`New user created: ${clientUuid.substring(0, 8)}... with fingerprint ${deviceFingerprint.substring(0, 8)}...`);
            }

            // Check quota before making request
            const requiredQuota = shouldCount ? parallelCount : 1;
            if (currentUsage + requiredQuota > dailyLimit) {
                return new Response(JSON.stringify({
                    error: 'Daily limit reached',
                    code: 'LIMIT_EXCEEDED',
                    usage: currentUsage,
                    limit: dailyLimit,
                    message: 'You have used all your free Guest Mode messages today. Get your own free API key at console.groq.com for unlimited use!'
                }), {
                    status: 429,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // Remove _meta before forwarding to Groq
            const groqBody = { ...body };
            delete groqBody._meta;

            // Proxy to Groq API
            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(groqBody)
            });

            // If successful and should count, increment usage
            if (groqResponse.ok && shouldCount) {
                // Upsert daily usage
                await env.DB.prepare(`
                    INSERT INTO daily_usage (device_fingerprint, usage_date, usage_count, last_used_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(device_fingerprint, usage_date) 
                    DO UPDATE SET usage_count = usage_count + ?, last_used_at = CURRENT_TIMESTAMP
                `).bind(userFingerprint, today, incrementBy, incrementBy).run();

                currentUsage += incrementBy;
                console.log(`Usage incremented: ${userFingerprint.substring(0, 8)}... = ${currentUsage} (+${incrementBy})`);
            }

            // Get response data
            const responseData = await groqResponse.json();

            // Add usage info to response
            const enrichedResponse = {
                ...responseData,
                _demo: {
                    usage: currentUsage,
                    limit: dailyLimit,
                    remaining: dailyLimit - currentUsage,
                    deviceId: userFingerprint.substring(0, 4) + '...'
                }
            };

            return new Response(JSON.stringify(enrichedResponse), {
                status: groqResponse.status,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });

        } catch (error) {
            console.error('Worker error:', error);
            return new Response(JSON.stringify({
                error: error.message || 'Internal error',
                code: 'INTERNAL_ERROR'
            }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }
};
