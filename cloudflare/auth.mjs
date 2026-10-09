import { createRemoteJWKSet, jwtVerify } from 'jose';
const keySets = new Map();
export function accessSettings(env) {
  const domain = env.ACCESS_TEAM_DOMAIN || '';
  const emails = String(env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !env.ACCESS_AUD || !emails.length) return null;
  return { issuer: `https://${domain}`, audience: env.ACCESS_AUD, emails };
}
export async function authorize(request, env, verifier = jwtVerify) {
  const settings = accessSettings(env);
  if (!settings) throw Object.assign(new Error('Cloudflare Access is not configured. Follow CLOUDFLARE.md before using this deployment.'), { status: 503 });
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw Object.assign(new Error('Sign in through Cloudflare Access to use this dashboard.'), { status: 401 });
  try {
    if (!keySets.has(settings.issuer)) keySets.set(settings.issuer, createRemoteJWKSet(new URL(`${settings.issuer}/cdn-cgi/access/certs`)));
    const { payload } = await verifier(token, keySets.get(settings.issuer), { issuer: settings.issuer, audience: settings.audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub'] });
    if (!payload.email || !settings.emails.includes(payload.email.toLowerCase())) throw new Error('Email not allowed');
    return payload.email;
  } catch {
    throw Object.assign(new Error('Access denied. Sign in with an allowed email address.'), { status: 403 });
  }
}
