import { validateIdempotencyKey } from './metadata.js';

export interface IdempotentResponse {
  status: number;
  body: unknown;
}

export type IdempotencyClaim =
  | { kind: 'new' }
  | { kind: 'replay'; response: IdempotentResponse }
  | { kind: 'conflict' };

interface Entry {
  request_hash: string;
  response?: IdempotentResponse;
}

export class IdempotencyLedger {
  private readonly entries = new Map<string, Entry>();

  claim(key: string, requestHash: string): IdempotencyClaim {
    validateIdempotencyKey(key);
    if (typeof requestHash !== 'string' || requestHash.length === 0) {
      throw new TypeError('request hash must be a non-empty string');
    }
    const existing = this.entries.get(key);
    if (!existing) {
      this.entries.set(key, { request_hash: requestHash });
      return { kind: 'new' };
    }
    if (existing.request_hash !== requestHash) {
      return { kind: 'conflict' };
    }
    return existing.response === undefined
      ? { kind: 'conflict' }
      : { kind: 'replay', response: existing.response };
  }

  complete(key: string, response: IdempotentResponse): void {
    validateIdempotencyKey(key);
    if (!Number.isSafeInteger(response.status) || response.status < 100 || response.status > 599) {
      throw new RangeError('response status must be a valid HTTP status');
    }
    const existing = this.entries.get(key);
    if (!existing) {
      throw new Error('Cannot complete an unclaimed idempotency key');
    }
    if (existing.response !== undefined) {
      throw new Error('Idempotency key is already completed');
    }
    existing.response = response;
  }
}
