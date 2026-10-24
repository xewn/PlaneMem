import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { runtimeConfig } from './config';

export const SESSION_COOKIE = 'planemem_session';
export const OIDC_STATE_COOKIE = 'planemem_oidc_state';
export const OIDC_VERIFIER_COOKIE = 'planemem_oidc_verifier';

export interface SessionClaims {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  id_token?: string;
  sub?: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  roles?: string[];
  tenant_id?: string;
  workspace_id?: string;
  project_id?: string;
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function createOidcState(): string {
  return base64Url(randomBytes(24));
}

export function encodeSession(session: SessionClaims): string {
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  const signature = createHmac('sha256', runtimeConfig.sessionSecret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

export function decodeSession(value: string | undefined): SessionClaims | undefined {
  if (!value) return undefined;
  try {
    const [payload, signature] = value.split('.');
    if (!payload || !signature) return undefined;
    const expected = createHmac('sha256', runtimeConfig.sessionSecret)
      .update(payload)
      .digest('base64url');
    const providedBytes = Buffer.from(signature, 'base64url');
    const expectedBytes = Buffer.from(expected, 'base64url');
    if (
      providedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(providedBytes, expectedBytes)
    )
      return undefined;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims;
    return typeof parsed.access_token === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function decodeJwtClaims(token: string): Partial<SessionClaims> {
  try {
    const payload = token.split('.')[1];
    if (!payload) return {};
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    return {
      sub: typeof parsed.sub === 'string' ? parsed.sub : undefined,
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      preferred_username:
        typeof parsed.preferred_username === 'string' ? parsed.preferred_username : undefined,
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
      roles: Array.isArray(parsed.role)
        ? parsed.role.filter((role): role is string => typeof role === 'string')
        : Array.isArray(parsed.roles)
          ? parsed.roles.filter((role): role is string => typeof role === 'string')
          : undefined,
      tenant_id: typeof parsed.tenant_id === 'string' ? parsed.tenant_id : undefined,
      workspace_id: typeof parsed.workspace_id === 'string' ? parsed.workspace_id : undefined,
      project_id: typeof parsed.project_id === 'string' ? parsed.project_id : undefined,
    };
  } catch {
    return {};
  }
}

export async function getSession(): Promise<SessionClaims | undefined> {
  const jar = await cookies();
  const session = decodeSession(jar.get(SESSION_COOKIE)?.value);
  if (!session || session.expires_at <= Math.floor(Date.now() / 1000)) return undefined;
  return session;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: runtimeConfig.appUrl.startsWith('https://'),
    path: '/',
    maxAge: 60 * 60 * 8,
  };
}
