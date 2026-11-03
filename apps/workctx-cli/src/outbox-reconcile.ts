import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ContractError, isSyncIdentifier, isUlid } from '@planemem/contracts';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';
import type {
  OutboxScope,
  OutboxReceiptReader,
  OutboxReconcileResult,
} from '@planemem/context-bridge';
import { callSyncEventReceipt, readEmbeddedSyncEventReceipt } from './sync-event-receipt.js';
import { captureOutboxReceipt, prepareOutboxReceiptOutput } from './outbox-receipt-file.js';

function usage(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use outbox reconcile EVENT_ID with optional --outbox EXISTING_FILE, --timeout-ms and --result-output NEW_FILE; no JSON, key or repeated options',
    { trace_id: trace, retryable: false },
  );
}
function readArguments(argv: string[], trace: string) {
  try {
    const args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: {
        outbox: { type: 'string' },
        'timeout-ms': { type: 'string' },
        'result-output': { type: 'string' },
      },
    });
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const id = args.positionals[2];
    const rawTimeout = args.values['timeout-ms'] ?? '30000';
    const timeout_ms = Number(rawTimeout);
    const resultOutput = args.values['result-output'];
    const path =
      args.values.outbox ??
      process.env.WORKCTX_OUTBOX ??
      join(homedir(), '.workctx', 'outbox.sqlite');
    if (
      args.positionals.length !== 3 ||
      args.positionals.slice(0, 2).join(' ') !== 'outbox reconcile' ||
      !isSyncIdentifier(id) ||
      !path.trim() ||
      path === ':memory:' ||
      path === '-' ||
      !/^[1-9][0-9]{0,9}$/.test(rawTimeout) ||
      timeout_ms > 2147483647 ||
      (resultOutput !== undefined && (!resultOutput.trim() || resultOutput === '-'))
    )
      throw new TypeError();
    return { event_id: id, path: resolve(path), timeout_ms, resultOutput };
  } catch {
    throw usage(trace);
  }
}
function originalScope(
  scope: { tenant_id: string; workspace_id: string; project_id: string },
  trace: string,
): OutboxScope {
  const { tenant_id, workspace_id, project_id } = scope;
  if (!isUlid(tenant_id) || !isUlid(workspace_id) || !isUlid(project_id)) throw usage(trace);
  return { tenant_id, workspace_id, project_id };
}
async function reconcileExisting(
  input: ReturnType<typeof readArguments>,
  scope: OutboxScope,
  trace: string,
  reader: OutboxReceiptReader,
) {
  const resultOutput =
    input.resultOutput === undefined
      ? undefined
      : await prepareOutboxReceiptOutput(input.resultOutput, trace);
  const noReceiptFile =
    resultOutput === undefined
      ? undefined
      : {
          state: 'not-written' as const,
          path: resultOutput.path,
          reason: 'no-validated-receipt' as const,
        };
  const { SqliteOutbox } = await import('@planemem/context-bridge');
  let queue: InstanceType<typeof SqliteOutbox>;
  try {
    queue = new SqliteOutbox(input.path, { existing: true });
  } catch (error) {
    if (error instanceof ContractError && error.envelope.code === 'OUTBOX_UPGRADE_REQUIRED')
      throw new ContractError(
        'OUTBOX_UPGRADE_REQUIRED',
        'The existing queue needs a separate schema upgrade before reconciliation',
        {
          trace_id: trace,
          retryable: false,
          ...(noReceiptFile === undefined ? {} : { result_file: noReceiptFile }),
        },
      );
    throw new ContractError(
      'OUTBOX_STORAGE_UNAVAILABLE',
      'Could not open the existing outbox; no original event was queried',
      {
        trace_id: trace,
        retryable: false,
        ...(noReceiptFile === undefined ? {} : { result_file: noReceiptFile }),
      },
    );
  }
  let result: OutboxReconcileResult;
  try {
    result = await queue.reconcile(input.event_id, scope, reader, {
      trace_id: trace,
      timeout_ms: input.timeout_ms,
    });
  } catch (error) {
    let close_pending = false;
    try {
      queue.close();
    } catch {
      close_pending = true;
    }
    const preserved =
      error instanceof ContractError ? error.envelope.details.reconciliation : undefined;
    const result_file =
      resultOutput &&
      preserved &&
      typeof preserved === 'object' &&
      !Array.isArray(preserved) &&
      'receipt' in preserved
        ? await captureOutboxReceipt(preserved.receipt, resultOutput, trace)
        : noReceiptFile;
    if (!close_pending && result_file === undefined) throw error;
    throw new ContractError(
      error instanceof ContractError ? error.envelope.code : 'OUTBOX_STORAGE_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'Local reconciliation could not be confirmed',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          ...(close_pending ? { close_pending: true } : {}),
          ...(result_file === undefined ? {} : { result_file }),
        },
      },
    );
  }
  let close_pending = false;
  try {
    queue.close();
  } catch {
    close_pending = true;
  }
  const result_file =
    resultOutput === undefined
      ? undefined
      : await captureOutboxReceipt(result.receipt, resultOutput, trace);
  if (result_file?.state === 'save-failed')
    throw new ContractError(
      'OUTBOX_RECEIPT_RESULT_SAVE_FAILED',
      'Reconciliation completed but the requested receipt file was not confirmed; preserve the complete result and inspect the reported paths',
      {
        trace_id: trace,
        retryable: false,
        details: {
          scope,
          completed_reconciliation: result,
          result_file,
          ...(close_pending ? { close_pending: true } : {}),
        },
      },
    );
  // A cleanup failure cannot erase a confirmed committed result.
  return {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: [{ type: 'outbox', id: scope.project_id }, ...result.receipt.source_refs],
    data: {
      scope,
      ...result,
      ...(close_pending ? { close_pending: true } : {}),
      ...(result_file === undefined ? {} : { result_file }),
    },
  };
}
export async function callOutboxReconcileArguments(
  argv: string[],
  options: {
    base: string;
    token: string;
    trace: string;
    scope: OutboxScope;
  },
) {
  const snapshot = structuredClone(options);
  const input = readArguments(argv, snapshot.trace);
  const scope = originalScope(snapshot.scope, snapshot.trace);
  return reconcileExisting(input, scope, snapshot.trace, (query, read) =>
    callSyncEventReceipt(query, {
      base: snapshot.base,
      token: snapshot.token,
      trace: read.trace_id,
      scope,
      timeout_ms: read.timeout_ms,
      signal: read.signal,
    }),
  );
}
export async function runOutboxReconcile(
  argv: string[],
  router: CommandRouter,
  original: RequestContext,
) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  const input = readArguments(argv, trace);
  const scope = originalScope(context, trace);
  return reconcileExisting(input, scope, trace, (query, read) =>
    readEmbeddedSyncEventReceipt(query, router, context, {
      timeout_ms: read.timeout_ms,
      signal: read.signal,
    }),
  );
}
