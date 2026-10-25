import { NextResponse } from 'next/server';
import {
  createOidcState,
  createPkcePair,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
} from '../../../lib/auth';
import { redirectUri, runtimeConfig } from '../../../lib/config';

export async function GET(request: Request) {
  const state = createOidcState();
  const { verifier, challenge } = createPkcePair();
  const url = new URL(`${runtimeConfig.issuer.replace(/\/$/, '')}/connect/authorize`);
  url.searchParams.set('client_id', runtimeConfig.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('scope', runtimeConfig.scope);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  const response = NextResponse.redirect(url, { status: 302 });
  response.cookies.set(OIDC_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: runtimeConfig.appUrl.startsWith('https://'),
    path: '/',
    maxAge: 600,
  });
  response.cookies.set(OIDC_VERIFIER_COOKIE, verifier, {
    httpOnly: true,
    sameSite: 'lax',
    secure: runtimeConfig.appUrl.startsWith('https://'),
    path: '/',
    maxAge: 600,
  });
  const incoming = new URL(request.url);
  const returnTo = incoming.searchParams.get('returnTo');
  if (returnTo?.startsWith('/'))
    response.cookies.set('planemem_return_to', returnTo, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });
  return response;
}
