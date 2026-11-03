import {
  ContractError,
  createUlid,
  buildEtag,
  validateSourceRef,
  type ProposalMutationReceipt,
} from '@planemem/contracts';
import { FetchWcpTransport } from '@planemem/sdk';
import { parseSubmissionReceipt } from './receipt.js';
import { SqliteProposalQueue, type ClaimedProposalJob } from './submission.js';

export interface ProposalFlushOptions {
  access_token: () => string | Promise<string>;
  /** One bounded pass; future retries are left for the next explicit invocation. */
  limit?: number;
  fetch?: typeof fetch;
}
export interface ProposalFlushResult {
  processed: number;
  submitted: number;
  retry: number;
  blocked: number;
  lease_lost: number;
  jobs: Array<{
    job_id: string;
    status: 'submitted' | 'retry' | 'blocked' | 'lease_lost';
    trace_id: string;
    error_code?: string;
  }>;
}

/** Submit existing, durable drafts only. No generation, review, or source rewriting. */
export async function flushProposalQueue(
  queue: SqliteProposalQueue,
  options: ProposalFlushOptions,
): Promise<ProposalFlushResult> {
  const limit = options.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new TypeError('limit must be between 1 and 100');
  const result: ProposalFlushResult = {
    processed: 0,
    submitted: 0,
    retry: 0,
    blocked: 0,
    lease_lost: 0,
    jobs: [],
  };
  const dueBefore = Date.now();
  // Each token acquisition + two requests is bounded below the queue's 60-second lease.
  // A slow database/event loop may still lose a lease; the token fences local settlement
  // and the original command key fences duplicate remote writes.
  for (let index = 0; index < limit; index++) {
    const claimed = queue.claim(dueBefore);
    if (!claimed) break;
    const trace_id = 'trace_worker_' + createUlid();
    result.processed++;
    if ('quarantined' in claimed) {
      result.blocked++;
      result.jobs.push({
        job_id: claimed.job_id,
        status: 'blocked',
        trace_id,
        error_code: claimed.error_code,
      });
      continue;
    }
    const job: ClaimedProposalJob = claimed;
    let sent = false;
    let receipt: ProposalMutationReceipt;
    try {
      // Freeze this attempt's token across the preflight and mutation. A refresh
      // callback is invoked again only for a new job/attempt.
      const token = await accessToken(options.access_token, trace_id);
      const transport = new FetchWcpTransport({
        base_url: queue.binding.gateway_url,
        access_token: () => token,
        timeout_ms: 20_000,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      });
      const headers = {
        'x-trace-id': trace_id,
        'x-tenant-id': queue.binding.tenant_id,
        'x-workspace-id': queue.binding.workspace_id,
        'x-project-id': queue.binding.project_id,
        'x-expected-actor-id': queue.binding.actor_id,
        'x-expected-client-id': queue.binding.client_id,
      };
      // Older gateways must fail before any write, rather than silently ignoring
      // the expected-identity headers introduced with this queue protocol.
      const preflight = record(
        await transport.request({
          method: 'GET',
          path: '/v1/proposals/submission-context',
          headers,
        }),
      );
      const identity = record(preflight?.data);
      if (
        preflight?.schema_version !== 1 ||
        preflight.trace_id !== trace_id ||
        !Array.isArray(preflight.source_refs) ||
        preflight.source_refs.length !== 0 ||
        identity?.identity_preconditions !== 1 ||
        identity.actor_id !== queue.binding.actor_id ||
        identity.client_id !== queue.binding.client_id ||
        identity.tenant_id !== queue.binding.tenant_id ||
        identity.workspace_id !== queue.binding.workspace_id ||
        identity.project_id !== queue.binding.project_id
      )
        throw new ContractError(
          'PROPOSAL_SUBMISSION_PROTOCOL_UNAVAILABLE',
          'Gateway submission identity protocol is unavailable',
          { trace_id },
        );
      sent = true;
      const response = record(
        await transport.request({
          method: 'POST',
          path: '/v1/proposals',
          headers: { ...headers, 'idempotency-key': job.idempotency_key },
          body: job.draft,
        }),
      );
      try {
        if (
          !response ||
          response.schema_version !== 1 ||
          response.trace_id !== trace_id ||
          response.revision !== 1 ||
          response.etag !== buildEtag(1) ||
          typeof response.server_cursor !== 'number' ||
          !Number.isSafeInteger(response.server_cursor) ||
          response.server_cursor < 1 ||
          !Array.isArray(response.source_refs) ||
          response.source_refs.length !== 1
        )
          throw new TypeError('Invalid submission envelope');
        receipt = parseSubmissionReceipt(response.data);
        const ref = validateSourceRef(response.source_refs[0]);
        if (ref.type !== 'proposal' || ref.id !== receipt.proposal_id || ref.revision !== 1)
          throw new TypeError('Invalid submission source reference');
      } catch {
        throw new ContractError(
          'PROPOSAL_SUBMISSION_RECEIPT_INVALID',
          'Gateway submission receipt is invalid',
          { trace_id, retryable: true },
        );
      }
    } catch (error) {
      const failure = submissionFailure(error, trace_id, sent);
      const settled = queue.fail(job, failure);
      const status = settled ? (failure.retryable ? 'retry' : 'blocked') : 'lease_lost';
      result[status]++;
      result.jobs.push({ job_id: job.job_id, status, trace_id, error_code: failure.code });
      continue;
    }
    // A local storage failure after remote success must propagate, leaving the
    // sending lease recoverable. Never turn it into a definite remote rejection.
    const status = queue.complete(job, receipt, trace_id) ? 'submitted' : 'lease_lost';
    result[status]++;
    result.jobs.push({ job_id: job.job_id, status, trace_id });
  }
  return result;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function accessToken(
  get: ProposalFlushOptions['access_token'],
  trace_id: string,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      Promise.resolve().then(get),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Token timeout')), 5_000);
      }),
    ]);
    if (typeof value !== 'string' || !/^[\x21-\x7e]+$/.test(value.trim()))
      throw new ContractError('UNAUTHENTICATED', 'A bearer token is required', { trace_id });
    return value.trim();
  } catch (error) {
    if (error instanceof ContractError && error.envelope.code === 'UNAUTHENTICATED') throw error;
    throw new ContractError(
      'WORKER_CREDENTIALS_UNAVAILABLE',
      'Could not obtain submission credentials',
      { trace_id, retryable: true },
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function submissionFailure(error: unknown, trace_id: string, sent: boolean) {
  const envelope = error instanceof ContractError ? error.envelope : undefined;
  const code =
    envelope && /^[A-Z][A-Z0-9_]{1,127}$/.test(envelope.code)
      ? envelope.code
      : 'PROPOSAL_SUBMISSION_UNKNOWN';
  // Unknown errors are conservative: a server may have committed before failing.
  const definite = [
    'INVALID_INPUT',
    'INVALID_JSON',
    'INVALID_REQUEST_CONTEXT',
    'UNAUTHENTICATED',
    'DENIED',
    'FORBIDDEN',
    'NOT_FOUND',
    'PROPOSAL_NOT_FOUND',
    'PROPOSAL_VERSION_CONFLICT',
    'PROPOSAL_SOURCE_STALE',
    'PROPOSAL_SOURCE_UNAVAILABLE',
    'PROPOSAL_EXPIRED',
    'IDEMPOTENCY_KEY_REUSED',
    'PROPOSAL_SUBMISSION_PROTOCOL_UNAVAILABLE',
  ].includes(code);
  const ambiguous = !definite;
  const retryable = ambiguous || envelope?.retryable === true;
  return { code, trace_id, retryable, uncertain: sent && (ambiguous || retryable) };
}
