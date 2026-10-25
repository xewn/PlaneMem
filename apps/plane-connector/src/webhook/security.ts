import { ContractError, type ErrorEnvelope } from '@planemem/contracts';

export interface WebhookHeaders {
  'x-plane-delivery-id'?: string;
  'x-plane-event-id'?: string;
  'x-plane-timestamp'?: string;
  'x-plane-signature'?: string;
  'x-trace-id'?: string;
  [key: string]: string | undefined;
}

export type WebhookVerification =
  | {
      valid: true;
      delivery_id: string;
      event_id: string;
      trace_id: string;
      raw_hash: string;
      received_at: string;
    }
  | { valid: false; error: ErrorEnvelope };

export async function signWebhook(
  rawBody: string,
  secret: string,
  timestamp: string,
): Promise<string> {
  const key = await importKey(secret);
  const data = new TextEncoder().encode(`${timestamp}.${rawBody}`);
  const signature = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, data));
  return `v1=${toHex(signature)}`;
}

export async function verifyWebhook(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<WebhookVerification> {
  const traceId = headers['x-trace-id'] ?? 'trace_unknown';
  const deliveryId = headers['x-plane-delivery-id'];
  const eventId = headers['x-plane-event-id'];
  const timestamp = headers['x-plane-timestamp'];
  const signature = headers['x-plane-signature'];
  if (!deliveryId || !eventId || !timestamp || !signature) {
    return invalid('WEBHOOK_HEADERS_MISSING', traceId, { missing: true });
  }
  if (rawBody.length > 1_048_576) {
    return invalid('WEBHOOK_PAYLOAD_TOO_LARGE', traceId, { max_bytes: 1_048_576 });
  }
  const timestampNumber = Number(timestamp);
  if (!Number.isSafeInteger(timestampNumber) || Math.abs(nowSeconds - timestampNumber) > 300) {
    return invalid('WEBHOOK_TIMESTAMP_OUT_OF_WINDOW', traceId, { timestamp });
  }
  const expected = await signWebhook(rawBody, secret, timestamp);
  if (!constantTimeEqual(expected, signature)) {
    return invalid('WEBHOOK_SIGNATURE_INVALID', traceId, { delivery_id: deliveryId });
  }
  return {
    valid: true,
    delivery_id: deliveryId,
    event_id: eventId,
    trace_id: traceId,
    raw_hash: await sha256(rawBody),
    received_at: new Date(nowSeconds * 1000).toISOString(),
  };
}

export async function acceptWebhook<T>(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string,
  enqueue: (input: {
    body: T;
    raw_body: string;
    delivery_id: string;
    event_id: string;
    trace_id: string;
  }) => unknown,
): Promise<{ accepted: true; delivery_id: string } | { accepted: false; error: ErrorEnvelope }> {
  const result = await verifyWebhook(rawBody, headers, secret);
  if (!result.valid) return { accepted: false, error: result.error };
  try {
    const body = JSON.parse(rawBody) as T;
    enqueue({
      body,
      raw_body: rawBody,
      delivery_id: result.delivery_id,
      event_id: result.event_id,
      trace_id: result.trace_id,
    });
    return { accepted: true, delivery_id: result.delivery_id };
  } catch (error) {
    return {
      accepted: false,
      error: new ContractError(
        'WEBHOOK_BODY_INVALID',
        error instanceof Error ? error.message : 'Invalid JSON body',
        {
          trace_id: result.trace_id,
          retryable: false,
        },
      ).envelope,
    };
  }
}

async function importKey(secret: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function sha256(value: string): Promise<string> {
  return toHex(
    new Uint8Array(
      await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  );
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function invalid(
  code: string,
  trace_id: string,
  details: Record<string, unknown>,
): WebhookVerification {
  return {
    valid: false,
    error: new ContractError(code, 'Webhook request rejected before queueing', {
      ...details,
      trace_id,
      retryable: false,
    }).envelope,
  };
}
