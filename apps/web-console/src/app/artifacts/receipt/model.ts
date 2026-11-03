import {
  parseArtifactReceiptQuery,
  parseArtifactReceiptEnvelope,
  type ArtifactReceiptQuery,
  type ArtifactReceiptEnvelope,
} from '@planemem/contracts';

// Leave room for the multipart action wrapper under the existing 1 MiB request limit.
export const ARTIFACT_REQUEST_BYTES = 1_000_000;
export const receiptErrorMessages = {
  signin: 'Sign in as the original account, then check again. The original client must also match.',
  denied:
    'This session cannot read the original receipt. Use the original account, client and project with file write access.',
  unavailable:
    'The receipt could not be read. Its absence or this error does not prove the original request failed. Keep the saved request and check again later.',
  mismatch:
    'This key belongs to different parameters. Keep the original request and recover its exact saved parameters; do not generate a new key.',
  legacy: 'A complete saved record is unavailable. The original result remains unconfirmed.',
  invalid:
    'The response did not match the original request. Keep it unchanged and check its receipt again later.',
} as const;
export type ArtifactReceiptFeedback =
  | { status: 'checked'; response: ArtifactReceiptEnvelope }
  | {
      status: 'error';
      request: ArtifactReceiptQuery;
      reason: keyof typeof receiptErrorMessages;
      trace?: string;
    };

export function decodeArtifactRequest(raw: unknown): ArtifactReceiptQuery {
  if (
    typeof raw !== 'string' ||
    !raw ||
    raw.length > ARTIFACT_REQUEST_BYTES ||
    new TextEncoder().encode(raw).byteLength > ARTIFACT_REQUEST_BYTES
  )
    throw new TypeError('Use a saved request JSON file no larger than 1 MB.');
  const request = parseArtifactReceiptQuery(JSON.parse(raw.replace(/^\uFEFF/, '')));
  encodeArtifactRequest(request);
  return request;
}

export function encodeArtifactRequest(value: unknown): string {
  const raw = JSON.stringify(parseArtifactReceiptQuery(value));
  if (new TextEncoder().encode(raw).byteLength > ARTIFACT_REQUEST_BYTES)
    throw new TypeError('The saved request exceeds the 1 MB limit for this page.');
  return raw;
}

export function parseArtifactReceiptFeedback(
  value: unknown,
  expected: ArtifactReceiptQuery,
): ArtifactReceiptFeedback {
  const row = object(value);
  if (row.status === 'checked') {
    only(row, ['status', 'response']);
    const response = object(row.response);
    if (typeof response.trace_id !== 'string') throw new TypeError('Missing receipt trace');
    return {
      status: 'checked',
      response: parseArtifactReceiptEnvelope(response, expected, response.trace_id),
    };
  }
  only(row, ['status', 'request', 'reason', 'trace']);
  if (
    row.status !== 'error' ||
    typeof row.reason !== 'string' ||
    !Object.hasOwn(receiptErrorMessages, row.reason) ||
    encodeArtifactRequest(row.request) !== encodeArtifactRequest(expected) ||
    (row.trace !== undefined &&
      (typeof row.trace !== 'string' ||
        !row.trace.trim() ||
        row.trace.length > 1024 ||
        /[\u0000-\u001f\u007f]/.test(row.trace)))
  )
    throw new TypeError('Invalid artifact receipt feedback');
  return {
    status: 'error',
    request: parseArtifactReceiptQuery(row.request),
    reason: row.reason as keyof typeof receiptErrorMessages,
    ...(typeof row.trace === 'string' ? { trace: row.trace } : {}),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid receipt feedback');
  return value as Record<string, unknown>;
}
function only(value: Record<string, unknown>, fields: string[]) {
  if (Object.keys(value).some((key) => !fields.includes(key)))
    throw new TypeError('Unexpected receipt feedback fields');
}
