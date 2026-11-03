import { createHmac } from 'node:crypto';
import { artifactDigest } from './persistent-model.js';

export interface S3ArtifactCredentials {
  access_key_id: string;
  secret_access_key: string;
  session_token?: string;
}

/** Internal SigV4 implementation for a query-free S3 GET/PUT to an already encoded path. */
export function signArtifactS3Request(
  method: 'GET' | 'PUT',
  url: URL,
  region: string,
  credentials: S3ArtifactCredentials,
  payloadHash: string,
  now = new Date(),
): Record<string, string> {
  const accessKey = credentials.access_key_id;
  const secretKey = credentials.secret_access_key;
  const token = credentials.session_token;
  if (
    typeof accessKey !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(accessKey) ||
    typeof secretKey !== 'string' ||
    !/^[\x21-\x7e]{1,4096}$/.test(secretKey) ||
    (token !== undefined && (typeof token !== 'string' || !/^[\x21-\x7e]{1,16384}$/.test(token))) ||
    !/^[a-z0-9-]{1,64}$/.test(region) ||
    !/^[a-f0-9]{64}$/.test(payloadHash) ||
    url.search ||
    url.hash ||
    !Number.isFinite(now.getTime())
  )
    throw new TypeError('Invalid S3 signing inputs');
  const dateTime = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = dateTime.slice(0, 8);
  const scope = `${date}/${region}/s3/aws4_request`;
  const headers: Record<string, string> = {
    'accept-encoding': 'identity',
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': dateTime,
    ...(token === undefined ? {} : { 'x-amz-security-token': token }),
    ...(method === 'PUT'
      ? { 'content-type': 'application/octet-stream', 'if-none-match': '*' }
      : {}),
  };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('');
  const canonicalRequest = [
    method,
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', dateTime, scope, artifactDigest(canonicalRequest)].join(
    '\n',
  );
  const dateKey = hmac(`AWS4${secretKey}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope},SignedHeaders=${signedHeaders},Signature=${hmac(signingKey, stringToSign).toString('hex')}`;
  return headers;
}

/** Preserve slashes between key segments and encode literal percent signs exactly once. */
export function encodeS3PathSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function hmac(key: string | Uint8Array, value: string) {
  return createHmac('sha256', key).update(value).digest();
}
