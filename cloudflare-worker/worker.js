// Snip & Ask Guest Mode - Cloudflare Worker
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
            // Use IP-based tracking only - cannot be bypassed by resetting extension
            // Cloudflare provides the real client IP in CF-Connecting-IP header
            const clientIP = request.headers.get('CF-Connecting-IP') || 'anonymous';

            // Hash the IP for privacy (don't store raw IPs)
            const encoder = new TextEncoder();
            const data = encoder.encode(clientIP + 'snip-ask-salt');
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const ipHash = hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');

            // Check rate limit using KV storage
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            const usageKey = `usage:${ipHash}:${today}`;
            const currentUsage = parseInt(await env.GUEST_USAGE.get(usageKey) || '0');
            const dailyLimit = parseInt(env.DAILY_LIMIT || '15');

            if (currentUsage >= dailyLimit) {
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
                await env.GUEST_USAGE.put(usageKey, String(currentUsage + 1), {
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
