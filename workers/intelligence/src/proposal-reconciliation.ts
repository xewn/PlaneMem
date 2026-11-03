import {
  ContractError,
  createUlid,
  parseProposalCreateReceiptEnvelope,
  syncJsonSnapshot,
  type ProposalCreateReceiptEnvelope,
} from '@planemem/contracts';
import { FetchWcpTransport, WcpClient } from '@planemem/sdk';
import type { SqliteProposalQueue } from './submission.js';
import type {
  ProposalReceiptTarget,
  ProposalLocalSettlement,
} from './proposal-reconciliation-state.js';

export interface ProposalQueueReceiptOptions {
  access_token: string;
  timeout_ms?: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}
export interface ProposalQueueReceiptResult {
  schema_version: 1;
  trace_id: string;
  binding: ProposalReceiptTarget['binding'];
  job_id: string;
  snapshot_sha256: string;
  receipt: ProposalCreateReceiptEnvelope;
  local: ProposalLocalSettlement | { state: 'not-requested'; mutation: 'none' };
}
export interface ProposalQueueReceiptRecovery {
  binding: ProposalReceiptTarget['binding'];
  job_id: string;
  snapshot_sha256: string;
  original: ProposalReceiptTarget['original'];
  receipt: ProposalCreateReceiptEnvelope | null;
  local: { mutation: string; phase?: string; rollback?: string };
}
/** Contains complete original proposal content, never credentials or raw gateway errors. */
export class ProposalQueueReceiptError extends ContractError {
  readonly recovery: ProposalQueueReceiptRecovery;
  constructor(
    code: string,
    trace: string,
    recovery: ProposalQueueReceiptRecovery,
    causeCode?: string,
  ) {
    super(
      code,
      'Keep the original task and receipt; remote creation or local settlement is not confirmed by this error',
      {
        trace_id: trace,
        retryable: false,
        ...(causeCode && /^[A-Z][A-Z0-9_]{1,127}$/.test(causeCode)
          ? { cause_code: causeCode }
          : {}),
      },
    );
    this.recovery = JSON.parse(
      syncJsonSnapshot(recovery, 4 * 1024 * 1024 + 65536),
    ) as ProposalQueueReceiptRecovery;
  }
}

export function readProposalQueueReceipt(
  queue: SqliteProposalQueue,
  id: string,
  options: ProposalQueueReceiptOptions,
) {
  return observe(queue, id, options, false);
}
export function reconcileProposalQueueJob(
  queue: SqliteProposalQueue,
  id: string,
  options: ProposalQueueReceiptOptions,
) {
  return observe(queue, id, options, true);
}
async function observe(
  queue: SqliteProposalQueue,
  id: string,
  options: ProposalQueueReceiptOptions,
  settle: boolean,
): Promise<ProposalQueueReceiptResult> {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (key) => !['access_token', 'timeout_ms', 'signal', 'fetch'].includes(key),
    ) ||
    typeof options.access_token !== 'string' ||
    !/^[\x21-\x7e]+$/.test(options.access_token.trim()) ||
    (options.fetch !== undefined && typeof options.fetch !== 'function')
  )
    throw new TypeError('Use receipt credentials and bounded read options');
  const timeout = options.timeout_ms === undefined ? 30000 : options.timeout_ms;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2147483647)
    throw new TypeError('Use a valid receipt timeout');
  const token = options.access_token.trim();
  const signal = options.signal;
  const fetch = options.fetch;
  const trace = 'trace_worker_receipt_' + createUlid();
  const target = queue.captureReceiptTarget(id, settle);
  let receipt: ProposalCreateReceiptEnvelope | null = null;
  let local: ProposalQueueReceiptResult['local'] = { state: 'not-requested', mutation: 'none' };
  try {
    const client = new WcpClient(
      new FetchWcpTransport({
        base_url: target.binding.gateway_url,
        access_token: () => token,
        timeout_ms: timeout,
        ...(fetch === undefined ? {} : { fetch }),
      }),
      {
        tenant_id: target.binding.tenant_id,
        workspace_id: target.binding.workspace_id,
        project_id: target.binding.project_id,
        trace_id: trace,
      },
    );
    receipt = parseProposalCreateReceiptEnvelope(
      await client.getProposalCreateReceipt(target.original, {
        timeout_ms: timeout,
        ...(signal === undefined ? {} : { signal }),
      }),
      target.original,
      trace,
    );
    if (settle) {
      if (signal?.aborted)
        throw new ContractError('GATEWAY_REQUEST_CANCELED', 'Stopped before local settlement', {
          trace_id: trace,
        });
      local = queue.applyCreationReceipt(target, receipt);
    }
    const result: ProposalQueueReceiptResult = {
      schema_version: 1,
      trace_id: trace,
      binding: target.binding,
      job_id: target.job_id,
      snapshot_sha256: target.snapshot_sha256,
      receipt,
      local,
    };
    syncJsonSnapshot(result, 4 * 1024 * 1024 + 65536);
    return result;
  } catch (error) {
    const details =
      error instanceof ContractError && error.envelope.code === 'PROPOSAL_RECONCILIATION_FAILED'
        ? error.envelope.details
        : {};
    const mutation =
      typeof details.mutation === 'string' &&
      ['not-started', 'rolled-back', 'not-confirmed'].includes(details.mutation)
        ? details.mutation
        : local.mutation === 'committed'
          ? 'committed'
          : 'not-started';
    const phase =
      typeof details.phase === 'string' &&
      ['begin', 'compare', 'write', 'readback', 'commit'].includes(details.phase)
        ? details.phase
        : undefined;
    const rollback =
      typeof details.rollback === 'string' &&
      ['not-started', 'completed', 'not-confirmed'].includes(details.rollback)
        ? details.rollback
        : undefined;
    throw new ProposalQueueReceiptError(
      receipt ? 'PROPOSAL_RECONCILIATION_UNCONFIRMED' : 'PROPOSAL_RECEIPT_UNCONFIRMED',
      trace,
      {
        binding: target.binding,
        job_id: target.job_id,
        snapshot_sha256: target.snapshot_sha256,
        original: target.original,
        receipt,
        local: {
          mutation,
          ...(phase === undefined ? {} : { phase }),
          ...(rollback === undefined ? {} : { rollback }),
        },
      },
      error instanceof ContractError ? error.envelope.code : undefined,
    );
  }
}
