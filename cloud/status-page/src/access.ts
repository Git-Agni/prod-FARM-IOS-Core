// Verifies the Cloudflare Access login token on every request, so the page stays closed even if the
// Access application in front of it were removed or misconfigured.

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }
let certCache: { at: number; keys: Jwk[] } | null = null;

function b64urlBytes(value: string) {
    const s = value.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function b64urlJson(value: string) {
    return JSON.parse(new TextDecoder().decode(b64urlBytes(value)));
}

async function certs(teamDomain: string, force = false) {
    if (!force && certCache && Date.now() - certCache.at < 3_600_000) return certCache.keys;
    const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`Access certs returned ${res.status}`);
    const keys = ((await res.json()) as { keys: Jwk[] }).keys;
    certCache = { at: Date.now(), keys };
    return keys;
}

/** Returns the signed-in email, or null when the token is missing or invalid. */
export async function verifyAccess(request: Request, env: { ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string }, now = Date.now()) {
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token || !env.ACCESS_AUD) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    let header: { kid?: string; alg?: string }, payload: { aud?: string | string[]; exp?: number; nbf?: number; iss?: string; email?: string };
    try { header = b64urlJson(h); payload = b64urlJson(p); } catch { return null; }
    if (header.alg !== 'RS256' || !header.kid) return null;

    let jwk = (await certs(env.ACCESS_TEAM_DOMAIN)).find(k => k.kid === header.kid);
    if (!jwk) jwk = (await certs(env.ACCESS_TEAM_DOMAIN, true)).find(k => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;

    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const seconds = now / 1000;
    if (!aud.includes(env.ACCESS_AUD)) return null;
    if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    if (!payload.exp || payload.exp < seconds) return null;
    if (payload.nbf && payload.nbf > seconds + 60) return null;
    return payload.email ?? null;
}
