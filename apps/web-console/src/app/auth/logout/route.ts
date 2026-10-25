import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../lib/auth';
import { runtimeConfig } from '../../../lib/config';

export async function GET() {
  const response = NextResponse.redirect(new URL('/login', runtimeConfig.appUrl));
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
