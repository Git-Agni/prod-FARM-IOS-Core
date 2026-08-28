import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';

// Fastify's `inject` sends `Host: localhost:80`. createApp's CSRF hook rejects
// state-changing requests whose Origin doesn't match the Host, so route write
// requests through here to attach the matching Origin a browser would send.
export const INJECT_ORIGIN = 'http://localhost:80';

export function inject(app: FastifyInstance, options: InjectOptions): Promise<LightMyRequestResponse> {
    const method = String(options.method ?? 'GET').toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return app.inject(options);
    return app.inject({ ...options, headers: { origin: INJECT_ORIGIN, ...options.headers } });
}
