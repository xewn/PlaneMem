import {
  ContractError,
  compareSavedContextPacks,
  isSyncIdentifier,
  parseContextPackComparisonQuery,
  parseSyncCommandIdentity,
  syncJsonSnapshot,
  type ContextPackComparisonQuery,
  type ContextPackReadEnvelope,
  type SavedContextPackComparison,
  type SyncCommandIdentity,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { captureContextRead } from './context-read-input.js';
import { readSavedContextPack, type WcpContextPackReadOptions } from './context-pack-read.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpContextPackComparisonResult {
  schema_version: 1;
  kind: 'saved-context-pack-comparison';
  comparison_origin: 'local';
  read_consistency: 'separate-reads';
  content_state: 'pack-hashes-checked';
  /** The SDK does not independently resolve or refresh pack sources. */
  source_state: 'not-checked';
  query: ContextPackComparisonQuery;
  identity_constraints: SyncCommandIdentity;
  from: ContextPackReadEnvelope;
  to: ContextPackReadEnvelope;
  comparison: SavedContextPackComparison;
}

const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply two different saved pack IDs, complete project/account/client identity and valid read options',
  DENIED: 'The current account or client cannot read both selected saved packs',
  UNAUTHENTICATED: 'Renew the matching session before comparing saved packs',
  CONTEXT_PACK_NOT_FOUND: 'A selected saved pack is unavailable in this project',
  CONTEXT_PACK_STALE: 'The sources of a selected saved pack changed',
  CONTEXT_PACK_EXPIRED: 'A selected saved pack expired',
  CONTEXT_PACK_INVALID: 'A selected saved pack could not be validated',
  CONTEXT_PACK_STORAGE_UNAVAILABLE: 'Saved context pack storage is unavailable',
  CONTEXT_SOURCE_LIMIT: 'Saved context pack source checks exceeded their limit',
  CONTEXT_PACK_INTEGRITY_UNAVAILABLE: 'Saved pack integrity checking is unavailable',
  CONTEXT_PACK_HASH_MISMATCH: 'A complete saved pack differs from its saved hash',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'A saved pack read audit could not be persisted',
  RATE_LIMITED: 'Saved pack reads are temporarily busy',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the saved pack comparison',
  GATEWAY_REQUEST_TIMEOUT: 'The complete saved pack comparison exceeded its local deadline',
  GATEWAY_RESPONSE_INVALID:
    'The complete saved packs or their comparison did not match this request or exceeded its limit',
  GATEWAY_UNAVAILABLE: 'The selected saved packs could not be compared',
};
function failure(code: string, trace: string) {
  return new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
}

/** Both exact reads, digests and the complete local result share one outer deadline. */
export async function compareContextPacks(
  transport: WcpTransport,
  original: RequestContext,
  input: ContextPackComparisonQuery,
  options: WcpContextPackReadOptions,
): Promise<WcpContextPackComparisonResult> {
  let trace = 'trace_unknown';
  let budget: RequestBudget | undefined;
  try {
    const originalTrace = original && Object.getOwnPropertyDescriptor(original, 'trace_id')?.value;
    if (isSyncIdentifier(originalTrace)) trace = originalTrace;
    let prepared;
    try {
      const settings = captureContextRead(original, options);
      const query = parseContextPackComparisonQuery(input);
      const context = settings.context;
      if (context.actor_id === undefined || context.client_id === undefined) throw new TypeError();
      const identity = parseSyncCommandIdentity({
        tenant_id: context.tenant_id,
        workspace_id: context.workspace_id,
        project_id: context.project_id,
        actor_id: context.actor_id,
        client_id: context.client_id,
      });
      prepared = { settings, query, identity };
      budget = createRequestBudget(trace, settings.timeout, settings.signal);
    } catch {
      throw failure('INVALID_INPUT', trace);
    }
    const { settings, query, identity } = prepared;
    const activeBudget = budget;
    activeBudget.check();
    const read = (packId: string) =>
      activeBudget.wait(() =>
        readSavedContextPack(
          transport,
          settings.context,
          { pack_id: packId, format: 'json' },
          { timeout_ms: settings.timeout, signal: activeBudget.signal },
        ),
      );
    const from = await read(query.from_pack_id);
    activeBudget.check();
    const to = await read(query.to_pack_id);
    activeBudget.check();
    let result: WcpContextPackComparisonResult;
    try {
      const comparison = compareSavedContextPacks(from, to);
      const combined: WcpContextPackComparisonResult = {
        schema_version: 1,
        kind: 'saved-context-pack-comparison',
        comparison_origin: 'local',
        read_consistency: 'separate-reads',
        content_state: 'pack-hashes-checked',
        source_state: 'not-checked',
        query,
        identity_constraints: identity,
        from,
        to,
        comparison,
      };
      result = JSON.parse(
        syncJsonSnapshot(combined, 12 * 1024 * 1024),
      ) as WcpContextPackComparisonResult;
    } catch {
      activeBudget.check();
      throw failure('GATEWAY_RESPONSE_INVALID', trace);
    }
    activeBudget.check();
    return result;
  } catch (error) {
    let finalError = error;
    try {
      budget?.check();
    } catch (stopped) {
      finalError = stopped;
    }
    const envelope = finalError instanceof ContractError ? finalError.envelope : undefined;
    throw failure(
      envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
        ? envelope.code
        : 'GATEWAY_UNAVAILABLE',
      trace,
    );
  } finally {
    budget?.close();
  }
}
