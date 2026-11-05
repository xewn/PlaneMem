import {
  ContractError,
  parseLegacyContextIdentity,
  parseIndexedContextWriteInput,
  parseIndexedContextWriteEnvelope,
  validateIdempotencyKey,
  LEGACY_INDEX_RESPONSE_BYTES,
  type IndexedContextInput,
  type LegacyContextIdentity,
  type IndexedContextWriteRequest,
  type IndexedContextWriteEnvelope,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { contextReadFields } from './context-read-input.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpLegacyContextIndexOptions {
  idempotency_key: string;
  expected_actor_id: string;
  expected_client_id: string;
  timeout_ms?: number;
  signal?: AbortSignal;
}
const messages = {
  INVALID_INPUT: 'Supply a manual index document, original request key, identity and valid budget',
  DENIED: 'This account or client cannot write or replay the index content',
  UNAUTHENTICATED: 'Renew the intended session before writing index content',
  CONTEXT_INDEX_VERSION_CONFLICT: 'Read current index status before preparing a new revision',
  IDEMPOTENCY_KEY_REUSED: 'The original index key belongs to another document',
  CONTEXT_PERSISTENCE_UNAVAILABLE: 'Index storage is unavailable; preserve the original request',
  SEARCH_RESULT_INVALID: 'The saved index content is invalid',
  MEMORY_PROVIDER_OFF: 'The required memory provider is not available',
  MEMORY_UNAVAILABLE: 'The required memory capture did not complete',
  MEMORY_SCOPE_MISMATCH: 'Memory capture returned a different scope',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The write audit could not be persisted',
  MOCK_CONTEXT_INDEX_CAPACITY: 'The simulated index or original receipt ledger is full',
  MOCK_CONTEXT_INDEX_CAPTURE_UNCONFIGURED: 'Configure this exact simulated capture input first',
  RATE_LIMITED: 'Index write capacity is occupied',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting; the index may already have been saved',
  GATEWAY_REQUEST_TIMEOUT: 'The deadline expired; the index may already have been saved',
  GATEWAY_RESPONSE_INVALID: 'The response did not match the complete original index request',
  GATEWAY_UNAVAILABLE: 'The index result is unknown; preserve the original request and key',
} as const;
function failure(code: keyof typeof messages, trace: string) {
  return new ContractError(code, messages[code], { trace_id: trace, retryable: false });
}

export async function writeLegacyContextIndex(
  transport: WcpTransport,
  original: RequestContext,
  input: IndexedContextWriteRequest,
  options: WcpLegacyContextIndexOptions,
): Promise<IndexedContextWriteEnvelope> {
  const trace = original.trace_id;
  let budget: RequestBudget | undefined;
  try {
    let prepared: { identity: LegacyContextIdentity; key: string; document: IndexedContextInput };
    try {
      const settings = contextReadFields(options, [
        'idempotency_key',
        'expected_actor_id',
        'expected_client_id',
        'timeout_ms',
        'signal',
      ]);
      const identity = parseLegacyContextIdentity({
        tenant_id: original.tenant_id,
        workspace_id: original.workspace_id,
        project_id: original.project_id,
        actor_id: settings.expected_actor_id,
        client_id: settings.expected_client_id,
      });
      if (
        (original.actor_id !== undefined && original.actor_id !== identity.actor_id) ||
        (original.client_id !== undefined && original.client_id !== identity.client_id)
      )
        throw new TypeError();
      const key = validateIdempotencyKey(settings.idempotency_key);
      const document = parseIndexedContextWriteInput(input);
      const timeout = settings.timeout_ms === undefined ? 30_000 : settings.timeout_ms;
      if (typeof timeout !== 'number') throw new TypeError();
      budget = createRequestBudget(trace, timeout, settings.signal as AbortSignal | undefined);
      prepared = { identity, key, document };
    } catch {
      throw failure('INVALID_INPUT', trace);
    }
    const { identity, key, document } = prepared;
    const scope = {
      tenant_id: identity.tenant_id,
      workspace_id: identity.workspace_id,
      project_id: identity.project_id,
    };
    const raw = await budget.wait(() =>
      transport.request({
        method: 'POST',
        path: '/v1/context/index',
        body: { ...document, source_refs: document.source_refs.map((ref) => ({ ...ref })) },
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': identity.tenant_id,
          'x-workspace-id': identity.workspace_id,
          'x-project-id': identity.project_id,
          'x-expected-actor-id': identity.actor_id,
          'x-expected-client-id': identity.client_id,
          'idempotency-key': key,
        },
        response_type: 'bounded-json',
        max_response_bytes: LEGACY_INDEX_RESPONSE_BYTES,
        signal: budget!.signal,
      }),
    );
    budget.check();
    let result;
    try {
      result = parseIndexedContextWriteEnvelope(raw, document, scope, trace);
    } catch {
      budget.check();
      throw failure('GATEWAY_RESPONSE_INVALID', trace);
    }
    budget.check();
    return result;
  } catch (error) {
    let final = error;
    try {
      budget?.check();
    } catch (stopped) {
      final = stopped;
    }
    const envelope = final instanceof ContractError ? final.envelope : undefined;
    throw failure(
      envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
        ? (envelope.code as keyof typeof messages)
        : 'GATEWAY_UNAVAILABLE',
      trace,
    );
  } finally {
    budget?.close();
  }
}
