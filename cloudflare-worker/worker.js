// Snip & Ask Demo Mode - Cloudflare Worker
// Deploy this to Cloudflare Workers to proxy Groq API requests with rate limiting

export default {
    async fetch(request, env) {
        // CORS headers for browser requests
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-Instance-ID',
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
            // Get instance ID from header (extension generates this once and stores it)
            // Fallback to IP-based ID if header missing (for backwards compatibility)
            let instanceId = request.headers.get('X-Instance-ID');

            if (!instanceId || instanceId.length < 10) {
                // Fallback: use client IP as instance ID (Cloudflare provides this)
                const clientIP = request.headers.get('CF-Connecting-IP') || 'anonymous';
                // Simple hash to anonymize IP
                instanceId = 'ip-' + btoa(clientIP).slice(0, 16);
            }

            // Check rate limit using KV storage
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            const usageKey = `usage:${instanceId}:${today}`;
            const currentUsage = parseInt(await env.DEMO_USAGE.get(usageKey) || '0');
            const dailyLimit = parseInt(env.DAILY_LIMIT || '5');

            if (currentUsage >= dailyLimit) {
                return new Response(JSON.stringify({
                    error: 'Daily limit reached',
                    code: 'LIMIT_EXCEEDED',
                    usage: currentUsage,
                    limit: dailyLimit,
                    message: 'You have used all your free demo messages today. Get your own free API key at console.groq.com for unlimited use!'
                }), {
                    status: 429,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // Parse the incoming request
            const body = await request.json();

            // Proxy to Groq API
            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body)
            });

            // If Groq request was successful, increment usage
            if (groqResponse.ok) {
                await env.DEMO_USAGE.put(usageKey, String(currentUsage + 1), {
                    expirationTtl: 86400 // Auto-expire after 24 hours
                });
            }

            // Get response data
            const responseData = await groqResponse.json();

            // Add usage info to response for the extension to display
            const enrichedResponse = {
                ...responseData,
                _demo: {
                    usage: currentUsage + 1,
                    limit: dailyLimit,
                    remaining: dailyLimit - currentUsage - 1
                }
            };

            return new Response(JSON.stringify(enrichedResponse), {
                status: groqResponse.status,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });

        } catch (error) {
            return new Response(JSON.stringify({ error: error.message || 'Internal error' }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }
};
