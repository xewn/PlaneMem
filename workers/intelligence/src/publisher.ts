import {
  ContractError,
  createUlid,
  buildEtag,
  validateSourceRef,
  parseProposalCreateReceiptQuery,
  type ProposalMutationReceipt,
} from '@planemem/contracts';
import { FetchWcpTransport, WcpClient } from '@planemem/sdk';
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
  creation_attempts: number;
  receipt_queries: number;
  submitted: number;
  retry: number;
  blocked: number;
  lease_lost: number;
  jobs: Array<{
    job_id: string;
    status: 'submitted' | 'retry' | 'blocked' | 'lease_lost';
    trace_id: string;
    action: 'none' | 'create' | 'receipt';
    error_code?: string;
  }>;
}

/** Submit durable drafts or read original receipts for unknown outcomes. */
export async function flushProposalQueue(
  queue: SqliteProposalQueue,
  options: ProposalFlushOptions,
): Promise<ProposalFlushResult> {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => !['access_token', 'limit', 'fetch'].includes(key)) ||
    typeof options.access_token !== 'function' ||
    (options.fetch !== undefined && typeof options.fetch !== 'function')
  )
    throw new TypeError('Supply a credential provider and flush options');
  const limit = options.limit === undefined ? 25 : options.limit;
  const getAccessToken = options.access_token;
  const send = options.fetch;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new TypeError('limit must be between 1 and 100');
  const result: ProposalFlushResult = {
    processed: 0,
    creation_attempts: 0,
    receipt_queries: 0,
    submitted: 0,
    retry: 0,
    blocked: 0,
    lease_lost: 0,
    jobs: [],
  };
  const dueBefore = Date.now();
  // Token acquisition + at most two requests fit within the queue's 60-second lease.
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
        action: 'none',
        error_code: claimed.error_code,
      });
      continue;
    }
    const job: ClaimedProposalJob = claimed;
    let sent = false;
    let action: 'none' | 'create' | 'receipt' = 'none';
    let receipt: ProposalMutationReceipt;
    try {
      // Freeze this attempt's token for creation or receipt reads. A refresh
      // callback is invoked again only for a new job/attempt.
      const token = await accessToken(getAccessToken, trace_id);
      if (!queue.ownsClaim(job)) {
        result.lease_lost++;
        result.jobs.push({ job_id: job.job_id, status: 'lease_lost', trace_id, action });
        continue;
      }
      const transport = new FetchWcpTransport({
        base_url: queue.binding.gateway_url,
        access_token: () => token,
        timeout_ms: 20_000,
        ...(send === undefined ? {} : { fetch: send }),
      });
      if (job.uncertain) {
        const { gateway_url: _gateway, ...identity } = queue.binding;
        const query = parseProposalCreateReceiptQuery({
          identity,
          request_key: job.idempotency_key,
          draft: job.draft,
        });
        action = 'receipt';
        result.receipt_queries++;
        const observed = await new WcpClient(transport, {
          tenant_id: identity.tenant_id,
          workspace_id: identity.workspace_id,
          project_id: identity.project_id,
          trace_id,
        }).getProposalCreateReceipt(query, { timeout_ms: 20_000 });
        if (observed.data.status === 'not-observed')
          throw new ContractError(
            'PROPOSAL_SUBMISSION_NOT_OBSERVED',
            'No original receipt was observed; retain the unknown task without resubmission',
            { trace_id },
          );
        const saved = observed.data.receipt;
        receipt = parseSubmissionReceipt({
          proposal_id: saved.proposal_id,
          status: saved.status,
          revision: saved.revision,
          event_id: saved.event_id,
          occurred_at: saved.occurred_at,
          replayed: true,
        });
      } else {
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
            response_type: 'bounded-json',
            max_response_bytes: 16 * 1024,
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
        if (!queue.ownsClaim(job)) {
          result.lease_lost++;
          result.jobs.push({ job_id: job.job_id, status: 'lease_lost', trace_id, action });
          continue;
        }
        sent = true;
        action = 'create';
        result.creation_attempts++;
        const response = record(
          await transport.request({
            method: 'POST',
            path: '/v1/proposals',
            headers: { ...headers, 'idempotency-key': job.idempotency_key },
            body: job.draft,
            response_type: 'bounded-json',
            max_response_bytes: 64 * 1024,
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
      }
    } catch (error) {
      const failure = submissionFailure(error, trace_id, sent);
      const settled = queue.fail(job, failure);
      const status = settled ? (failure.retryable ? 'retry' : 'blocked') : 'lease_lost';
      result[status]++;
      result.jobs.push({ job_id: job.job_id, status, trace_id, action, error_code: failure.code });
      continue;
    }
    // A local storage failure after remote success must propagate, leaving the
    // sending lease recoverable. Never turn it into a definite remote rejection.
    const status = queue.complete(job, receipt, trace_id) ? 'submitted' : 'lease_lost';
    result[status]++;
    result.jobs.push({ job_id: job.job_id, status, trace_id, action });
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
