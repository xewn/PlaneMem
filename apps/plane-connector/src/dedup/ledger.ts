import { ContractError, createUlid, type ErrorEnvelope } from '@planemem/contracts';

export type DeduplicationResult =
  | { kind: 'new'; delivery_id: string; event_id: string }
  | { kind: 'duplicate'; delivery_id: string; event_id: string }
  | { kind: 'conflict'; error: ErrorEnvelope };

export interface RetryInput {
  delivery_id: string;
  event_id: string;
  payload: unknown;
  trace_id: string;
}

export type RetryResult =
  | { kind: 'retry'; retry_count: number; next_attempt_at: string }
  | { kind: 'dead_letter'; id: string; retry_count: number };

interface DeadLetter {
  id: string;
  input: RetryInput;
  reason: string;
  retry_count: number;
  replayed: boolean;
}

export class WebhookLedger {
  private readonly deliveries = new Map<string, string>();
  private readonly events = new Set<string>();
  private readonly deadLetters = new Map<string, DeadLetter>();

  deduplicate(delivery_id: string, event_id: string): DeduplicationResult {
    const existingDelivery = this.deliveries.get(delivery_id);
    if (existingDelivery !== undefined) {
      if (existingDelivery === event_id) return { kind: 'duplicate', delivery_id, event_id };
      return {
        kind: 'conflict',
        error: new ContractError(
          'WEBHOOK_DELIVERY_CONFLICT',
          'Delivery ID was reused for another event',
          {
            delivery_id,
            existing_event_id: existingDelivery,
            event_id,
            trace_id: 'trace_webhook_dedup',
            retryable: false,
          },
        ).envelope,
      };
    }
    if (this.events.has(event_id)) return { kind: 'duplicate', delivery_id, event_id };
    this.deliveries.set(delivery_id, event_id);
    this.events.add(event_id);
    return { kind: 'new', delivery_id, event_id };
  }

  enqueueRetry(input: RetryInput, reason: string, maxAttempts = 5): RetryResult {
    const existing = [...this.deadLetters.values()].find(
      (entry) => entry.input.event_id === input.event_id,
    );
    const retryCount = (existing?.retry_count ?? 0) + 1;
    if (retryCount >= maxAttempts) {
      const id = existing?.id ?? createUlid();
      this.deadLetters.set(id, { id, input, reason, retry_count: retryCount, replayed: false });
      return { kind: 'dead_letter', id, retry_count: retryCount };
    }
    return {
      kind: 'retry',
      retry_count: retryCount,
      next_attempt_at: new Date(Date.now() + retryCount * 1000).toISOString(),
    };
  }

  replayDeadLetter(
    id: string,
    handler: (input: RetryInput) => unknown,
  ): { status: 'replayed' | 'duplicate' | 'missing' } {
    const entry = this.deadLetters.get(id);
    if (!entry) return { status: 'missing' };
    if (entry.replayed) return { status: 'duplicate' };
    try {
      handler(entry.input);
      entry.replayed = true;
      return { status: 'replayed' };
    } catch {
      return { status: 'missing' };
    }
  }
}
