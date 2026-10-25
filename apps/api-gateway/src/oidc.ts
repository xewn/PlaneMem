import {
  createPublicKey,
  verify as verifySignature,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';

export interface OidcClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  scope?: string;
  [key: string]: unknown;
}

export interface OidcTokenVerifierOptions {
  issuer: string;
  audience?: string | undefined;
  fetch_impl?: typeof fetch | undefined;
  clock?: (() => number) | undefined;
  cache_ttl_ms?: number | undefined;
}

interface OidcDiscovery {
  issuer: string;
  jwks_uri: string;
}

interface JwksResponse {
  keys: Array<JsonWebKey & { kid?: string; kty?: string; alg?: string; use?: string }>;
}

export class OidcTokenError extends Error {
  readonly code = 'UNAUTHENTICATED';

  constructor(message: string) {
    super(message);
    this.name = 'OidcTokenError';
  }
}

export class OidcTokenVerifier {
  private readonly issuer: string;
  private readonly audience: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => number;
  private readonly cacheTtlMs: number;
  private discovery: OidcDiscovery | undefined;
  private jwks: { expiresAt: number; keys: Map<string, KeyObject> } | undefined;

  constructor(options: OidcTokenVerifierOptions) {
    if (!options.issuer) throw new Error('OIDC issuer is required');
    this.issuer = options.issuer.replace(/\/+$/, '');
    this.audience = options.audience;
    this.fetchImpl = options.fetch_impl ?? fetch;
    this.clock = options.clock ?? (() => Date.now());
    this.cacheTtlMs = options.cache_ttl_ms ?? 5 * 60_000;
  }

  async verifyAuthorization(authorization: string | undefined): Promise<OidcClaims> {
    const token = parseBearer(authorization);
    const parts = token.split('.');
    if (parts.length !== 3) throw new OidcTokenError('Bearer token is not a compact JWT');
    const headerPart = parts[0] as string;
    const payloadPart = parts[1] as string;
    const signaturePart = parts[2] as string;
    const header = parseJson(headerPart, 'JWT header') as Record<string, unknown>;
    const payload = parseJson(payloadPart, 'JWT claims') as Partial<OidcClaims>;
    if (header.alg !== 'RS256') throw new OidcTokenError('JWT algorithm is not allowed');
    if (typeof header.kid !== 'string' || header.kid.length === 0)
      throw new OidcTokenError('JWT key id is missing');
    if (
      typeof payload.iss !== 'string' ||
      normalizeIssuer(payload.iss) !== this.issuer ||
      typeof payload.sub !== 'string' ||
      typeof payload.exp !== 'number'
    )
      throw new OidcTokenError('JWT issuer, subject or expiry is invalid');
    if (this.audience !== undefined && !hasAudience(payload.aud, this.audience))
      throw new OidcTokenError('JWT audience is invalid');
    const now = Math.floor(this.clock() / 1000);
    if (payload.exp <= now) throw new OidcTokenError('Bearer token has expired');
    if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf > now))
      throw new OidcTokenError('Bearer token is not active');
    const keys = await this.getKeys();
    const key = keys.get(header.kid);
    if (!key) {
      this.jwks = undefined;
      const refreshed = await this.getKeys();
      const refreshedKey = refreshed.get(header.kid);
      if (!refreshedKey) throw new OidcTokenError('JWT signing key is unknown');
      if (!verifyJwt(headerPart, payloadPart, signaturePart, refreshedKey))
        throw new OidcTokenError('JWT signature is invalid');
    } else if (!verifyJwt(headerPart, payloadPart, signaturePart, key)) {
      throw new OidcTokenError('JWT signature is invalid');
    }
    return payload as OidcClaims;
  }

  private async getKeys(): Promise<Map<string, KeyObject>> {
    const now = this.clock();
    if (this.jwks && this.jwks.expiresAt > now) return this.jwks.keys;
    const discovery = await this.getDiscovery();
    const response = await this.fetchImpl(discovery.jwks_uri, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new OidcTokenError('OIDC JWKS endpoint is unavailable');
    const body = (await response.json()) as JwksResponse;
    const keys = new Map<string, KeyObject>();
    for (const jwk of body.keys ?? []) {
      if (typeof jwk.kid !== 'string' || jwk.kty !== 'RSA') continue;
      try {
        keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
      } catch {
        continue;
      }
    }
    if (keys.size === 0) throw new OidcTokenError('OIDC JWKS contains no usable RSA keys');
    this.jwks = { expiresAt: now + this.cacheTtlMs, keys };
    return keys;
  }

  private async getDiscovery(): Promise<OidcDiscovery> {
    if (this.discovery) return this.discovery;
    const response = await this.fetchImpl(this.issuer + '/.well-known/openid-configuration', {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new OidcTokenError('OIDC discovery endpoint is unavailable');
    const body = (await response.json()) as Partial<OidcDiscovery>;
    if (
      typeof body.issuer !== 'string' ||
      normalizeIssuer(body.issuer) !== this.issuer ||
      typeof body.jwks_uri !== 'string'
    )
      throw new OidcTokenError('OIDC discovery metadata is invalid');
    this.discovery = { issuer: body.issuer, jwks_uri: body.jwks_uri };
    return this.discovery;
  }
}

function parseBearer(authorization: string | undefined): string {
  if (!authorization?.startsWith('Bearer ')) throw new OidcTokenError('Bearer token is required');
  const token = authorization.slice(7).trim();
  if (!token) throw new OidcTokenError('Bearer token is required');
  return token;
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new OidcTokenError(label + ' is invalid');
  }
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/, '');
}

function hasAudience(value: unknown, audience: string): boolean {
  return typeof value === 'string'
    ? value === audience
    : Array.isArray(value) && value.includes(audience);
}

function verifyJwt(header: string, payload: string, signature: string, key: KeyObject): boolean {
  try {
    return verifySignature(
      'RSA-SHA256',
      Buffer.from(header + '.' + payload),
      key,
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return false;
  }
}
