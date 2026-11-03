import {
  ContractError,
  type SyncEventReceiptQuery,
  type SyncEventReceiptEnvelope,
} from '@planemem/contracts';
import type { LocalEvent } from './sqlite.js';

export interface OutboxReconcileOptions {
  trace_id: string;
  timeout_ms?: number;
  signal?: AbortSignal;
}
/** Must query the trusted gateway with the preserved identity; never send the event. */
export type OutboxReceiptReader = (
  query: SyncEventReceiptQuery,
  options: { trace_id: string; timeout_ms: number; signal: AbortSignal },
) => Promise<unknown>;
export interface OutboxReconcileResult {
  receipt: SyncEventReceiptEnvelope;
  local: {
    event_id: string;
    status: LocalEvent['status'];
    action: 'settled' | 'already-settled' | 'unchanged';
  };
}
/** Describes this invocation only; another sender may have changed the row. */
export interface OutboxReconcileFailure {
  receipt: SyncEventReceiptEnvelope;
  local: {
    event_id: string;
    settlement: 'not-committed' | 'unknown';
  };
  transaction: {
    phase: 'not-started' | 'begin' | 'body' | 'commit';
    rollback: 'not-needed' | 'succeeded' | 'failed';
  };
}
export interface ReconciliationTransactionState {
  settlement: OutboxReconcileFailure['local']['settlement'];
  phase: OutboxReconcileFailure['transaction']['phase'];
  rollback: OutboxReconcileFailure['transaction']['rollback'];
}

/** Never roll back an unowned transaction or let cleanup erase the original failure. */
export function reconciliationTransaction<T>(
  exec: (sql: string) => void,
  run: () => T,
  state: ReconciliationTransactionState,
  trace: string,
  beforeCommit: () => void,
): T {
  state.phase = 'begin';
  exec('BEGIN IMMEDIATE');
  try {
    state.phase = 'body';
    const result = run();
    beforeCommit();
    state.phase = 'commit';
    state.settlement = 'unknown';
    exec('COMMIT');
    return result;
  } catch (error) {
    try {
      exec('ROLLBACK');
      state.rollback = 'succeeded';
    } catch {
      state.rollback = 'failed';
      state.settlement = 'unknown';
    }
    if (state.phase === 'commit')
      throw reconciliationError(
        'OUTBOX_COMMIT_UNKNOWN',
        'The local commit could not be confirmed; preserve the receipt and inspect the original row',
        trace,
      );
    throw error;
  }
}
export function reconciliationError(code: string, message: string, trace: string): ContractError {
  return new ContractError(code, message, { trace_id: trace, retryable: false });
}

/** Local waiting only. A late reader result cannot continue into local settlement. */
export function reconciliationBudget(options: OutboxReconcileOptions) {
  let trace = 'trace_outbox_reconcile';
  let timeout: number;
  let external: AbortSignal | undefined;
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError();
    const prototype: unknown = Object.getPrototypeOf(options);
    const fields = Object.keys(options);
    if (
      (prototype !== null && prototype !== Object.prototype) ||
      Reflect.ownKeys(options).length !== fields.length ||
      fields.some(
        (key) =>
          !['trace_id', 'timeout_ms', 'signal'].includes(key) ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key)!, 'value'),
      )
    )
      throw new TypeError();
    if (
      !Object.hasOwn(options, 'trace_id') ||
      typeof options.trace_id !== 'string' ||
      !options.trace_id.trim() ||
      options.trace_id.length > 1024 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(options.trace_id)
    )
      throw new TypeError();
    trace = options.trace_id;
    const supplied = Object.hasOwn(options, 'timeout_ms') ? options.timeout_ms : undefined;
    timeout = supplied === undefined ? 30_000 : supplied;
    external = Object.hasOwn(options, 'signal') ? options.signal : undefined;
    if (
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 2147483647 ||
      (external !== undefined &&
        (!external ||
          typeof external !== 'object' ||
          typeof external.aborted !== 'boolean' ||
          typeof external.addEventListener !== 'function' ||
          typeof external.removeEventListener !== 'function'))
    )
      throw new TypeError();
  } catch {
    throw reconciliationError(
      'INVALID_INPUT',
      'Supply an outbox reconciliation trace and valid timeout/signal options',
      trace,
    );
  }
  const controller = new AbortController();
  const deadline = performance.now() + timeout;
  const abort = () => controller.abort();
  external?.addEventListener('abort', abort, { once: true });
  if (external?.aborted) abort();
  const timer = setTimeout(abort, timeout);
  const stopped = () =>
    reconciliationError(
      external?.aborted ? 'OUTBOX_RECONCILE_CANCELED' : 'OUTBOX_RECONCILE_TIMEOUT',
      'Stopped waiting for original delivery confirmation; keep the original local event',
      trace,
    );
  const check = () => {
    if (controller.signal.aborted || performance.now() >= deadline) {
      abort();
      throw stopped();
    }
  };
  return {
    trace,
    timeout,
    signal: controller.signal,
    check,
    wait<T>(read: () => Promise<T>): Promise<T> {
      check();
      return new Promise<T>((resolve, reject) => {
        let finished = false;
        const cleanup = () => controller.signal.removeEventListener('abort', onAbort);
        const onAbort = () => {
          if (finished) return;
          finished = true;
          cleanup();
          reject(stopped());
        };
        controller.signal.addEventListener('abort', onAbort, { once: true });
        let pending: Promise<T>;
        try {
          check();
          pending = read();
        } catch (error) {
          finished = true;
          cleanup();
          reject(error);
          return;
        }
        Promise.resolve(pending).then(
          (value) => {
            if (finished) return;
            finished = true;
            cleanup();
            try {
              check();
              resolve(value);
            } catch (error) {
              reject(error);
            }
          },
          (error: unknown) => {
            if (finished) return;
            finished = true;
            cleanup();
            try {
              check();
              reject(error);
            } catch (stoppedError) {
              reject(stoppedError);
            }
          },
        );
      });
    },
    close() {
      clearTimeout(timer);
      try {
        external?.removeEventListener('abort', abort);
      } catch {
        /* Cleanup must not obscure committed state. */
      }
      abort();
    },
  };
}
