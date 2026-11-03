import {
  ContractError,
  parsePlaneInboxListQuery,
  parsePlaneInboxRecordQuery,
  parsePlaneInboxPage,
  parsePlaneInboxRecord,
  parsePlaneInboxSummary,
  parsePlaneInboxSummaryQuery,
  parsePlaneInboxDiagnosis,
  type ObservedScope,
  parsePlaneInboxIdentity,
  parsePlaneInboxRetryQuery,
  parsePlaneInboxRetryReceipt,
  parsePlaneInboxRetryLookup,
  type PlaneInboxIdentity,
} from '@planemem/contracts';

type PreparedPlaneInboxRead =
  | { kind: 'diagnosis'; input: { event_id: string } }
  | { kind: 'summary'; input: Record<string, never> }
  | { kind: 'list'; input: ReturnType<typeof parsePlaneInboxListQuery> }
  | { kind: 'record'; input: { event_id: string } };

interface PreparedPlaneInboxRetry {
  lookup: boolean;
  input: ReturnType<typeof parsePlaneInboxRetryQuery>;
  identity: PlaneInboxIdentity;
}

/** Both transports consume the same saved original request and identity preconditions. */
export function preparePlaneInboxRetry(
  command: string,
  input: Record<string, unknown>,
  scope: ObservedScope,
  traceId: string,
  key?: string,
): PreparedPlaneInboxRetry | undefined {
  if (command !== 'plane-events retry' && command !== 'plane-events retry-receipt') return;
  try {
    const lookup = command === 'plane-events retry-receipt';
    if (lookup && key !== undefined)
      throw new TypeError('Receipt queries use the original request_key in JSON, without --key');
    const { expected_actor_id, expected_client_id, ...fields } = input;
    const query = parsePlaneInboxRetryQuery({
      ...fields,
      request_key: fields.request_key === undefined ? key : fields.request_key,
    });
    if (key !== undefined && key !== query.request_key)
      throw new TypeError('--key and request_key disagree');
    const identity = parsePlaneInboxIdentity({
      tenant_id: scope.tenant_id,
      workspace_id: scope.workspace_id,
      project_id: scope.project_id,
      actor_id: expected_actor_id,
      client_id: expected_client_id,
    });
    return { lookup, input: query, identity };
  } catch (error) {
    throw new ContractError(
      'USAGE_ERROR',
      error instanceof Error ? error.message : 'Invalid event retry request',
      { trace_id: traceId },
    );
  }
}

export function planeInboxRetryResult(
  value: unknown,
  prepared: PreparedPlaneInboxRetry,
  traceId: string,
) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const result = value as Record<string, unknown>;
    if (
      result.schema_version !== 1 ||
      result.trace_id !== traceId ||
      !Array.isArray(result.source_refs) ||
      result.source_refs.length !== 0
    )
      throw new Error();
    const { request_key, ...command } = prepared.input;
    const data = prepared.lookup
      ? parsePlaneInboxRetryLookup(result.data, command, prepared.identity, request_key)
      : parsePlaneInboxRetryReceipt(result.data, command, prepared.identity, request_key);
    return { ...result, schema_version: 1 as const, trace_id: traceId, source_refs: [], data };
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Expected a retry receipt matching the original request and identity',
      { trace_id: traceId },
    );
  }
}

export function preparePlaneInboxRead(
  command: string,
  input: Record<string, unknown>,
  traceId: string,
): PreparedPlaneInboxRead | undefined {
  if (
    ![
      'plane-events list',
      'plane-events get',
      'plane-events summary',
      'plane-events diagnose',
    ].includes(command)
  )
    return;
  try {
    if (command === 'plane-events diagnose')
      return { kind: 'diagnosis', input: parsePlaneInboxRecordQuery(input) };
    if (command === 'plane-events summary')
      return { kind: 'summary', input: parsePlaneInboxSummaryQuery(input) };
    return command === 'plane-events list'
      ? { kind: 'list', input: parsePlaneInboxListQuery(input) }
      : { kind: 'record', input: parsePlaneInboxRecordQuery(input) };
  } catch (error) {
    throw new ContractError(
      'USAGE_ERROR',
      error instanceof Error ? error.message : 'Invalid event queue query',
      { trace_id: traceId },
    );
  }
}

export function planeInboxReadResult(
  value: unknown,
  read: PreparedPlaneInboxRead,
  scope: ObservedScope,
  traceId: string,
) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const result = value as Record<string, unknown>;
    if (
      result.schema_version !== 1 ||
      result.trace_id !== traceId ||
      !Array.isArray(result.source_refs) ||
      result.source_refs.length !== 0
    )
      throw new Error();
    const data =
      read.kind === 'diagnosis'
        ? parsePlaneInboxDiagnosis(result.data, scope, read.input.event_id)
        : read.kind === 'summary'
          ? parsePlaneInboxSummary(result.data, scope)
          : read.kind === 'list'
            ? parsePlaneInboxPage(result.data, scope, read.input)
            : parsePlaneInboxRecord(result.data, scope, read.input.event_id);
    return { ...result, schema_version: 1 as const, trace_id: traceId, source_refs: [], data };
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Expected matching scoped event queue metadata',
      { trace_id: traceId },
    );
  }
}
