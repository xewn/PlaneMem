import { NextResponse } from 'next/server';
import {
  decodeJwtClaims,
  encodeSession,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '../../../lib/auth';
import { redirectUri, runtimeConfig } from '../../../lib/config';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const stateCookie = request.headers
    .get('cookie')
    ?.match(new RegExp(`${OIDC_STATE_COOKIE}=([^;]+)`))?.[1];
  const verifier = request.headers
    .get('cookie')
    ?.match(new RegExp(`${OIDC_VERIFIER_COOKIE}=([^;]+)`))?.[1];
  if (!code || !state || !stateCookie || state !== decodeURIComponent(stateCookie) || !verifier) {
    return NextResponse.redirect(new URL('/login?error=invalid_callback', runtimeConfig.appUrl));
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: runtimeConfig.clientId,
    code,
    redirect_uri: redirectUri(),
    code_verifier: decodeURIComponent(verifier),
  });
  if (runtimeConfig.clientSecret) body.set('client_secret', runtimeConfig.clientSecret);
  const tokenResponse = await fetch(`${runtimeConfig.issuer.replace(/\/$/, '')}/connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!tokenResponse.ok)
    return NextResponse.redirect(new URL('/login?error=token_exchange', runtimeConfig.appUrl));
  const tokens = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token)
    return NextResponse.redirect(new URL('/login?error=missing_token', runtimeConfig.appUrl));
  const claims = decodeJwtClaims(tokens.id_token ?? tokens.access_token);
  const response = NextResponse.redirect(new URL('/overview', runtimeConfig.appUrl));
  response.cookies.set(
    SESSION_COOKIE,
    encodeSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      id_token: tokens.id_token,
      expires_at: Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 3600),
      ...claims,
    }),
    sessionCookieOptions(),
  );
  response.cookies.delete(OIDC_STATE_COOKIE);
  response.cookies.delete(OIDC_VERIFIER_COOKIE);
  return response;
}
