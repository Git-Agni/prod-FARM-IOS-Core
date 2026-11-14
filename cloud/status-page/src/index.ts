import { verifyAccess } from './access.ts';
import { loadSnapshot } from './data.ts';
import { renderPage } from './render.ts';

interface Env { HYPERDRIVE: Hyperdrive; ACCESS_AUD: string; ACCESS_TEAM_DOMAIN: string; CONTROL_URL: string }

const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Read-only', { status: 405, headers });
        const email = await verifyAccess(request, env);
        if (!email) return new Response('Sign-in required (Cloudflare Access).', { status: 403, headers });

        const url = new URL(request.url);
        if (url.pathname !== '/' && url.pathname !== '/api/status') return new Response('Not found', { status: 404, headers });
        try {
            const snapshot = await loadSnapshot(env.HYPERDRIVE.connectionString);
            if (url.pathname === '/api/status') return Response.json(snapshot, { headers });
            return new Response(renderPage(snapshot, env.CONTROL_URL, email), { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
        } catch (error) {
            console.error('snapshot failed', error instanceof Error ? error.message : String(error));
            return new Response('Could not read the Phone Farm database. Try again in a minute.', { status: 503, headers });
        }
    },
};
