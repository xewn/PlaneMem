import {
  ContractError,
  parseSyncCommandIdentity,
  parseWorkItemListQuery,
  parseWorkItemProjection,
  parseWorkItemProjectionList,
  parseWorkItemProjectionQuery,
  syncJsonSnapshot,
  validateErrorEnvelope,
  validateSourceRef,
  type WorkItemListQuery,
} from '@planemem/contracts';
import type { ApiGateway, HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

type ToolName = 'list_work_item_projections' | 'get_work_item_projection';
type Query =
  | { kind: 'list'; value: WorkItemListQuery }
  | { kind: 'detail'; value: { item_id: string } };
const responseBytes = 2 * 1024 * 1024;
const activeReads = new WeakMap<ApiGateway, { active: number }>();
const messages = {
  INVALID_INPUT:
    'Supply valid saved work item filters or a local item_id without identity or write fields; preserve filters for continuation',
  DENIED:
    'Use a verified unexpired client with actual context.read and the required record visibility',
  UNAUTHENTICATED: 'Renew the intended session before reading work items',
  NOT_FOUND: 'The work item read route is unavailable',
  WORK_ITEM_NOT_FOUND: 'The requested work item is unavailable in this project',
  WORK_ITEM_PROJECTION_INVALID: 'The stored work item response is invalid',
  WORKBENCH_DATABASE_UNAVAILABLE: 'The work item projection store is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The work item read audit could not be persisted',
  RATE_LIMITED: 'Gateway request capacity is occupied',
  MCP_WORK_ITEM_READ_BUSY: 'MCP work item read capacity is occupied',
  MCP_WORK_ITEM_READ_TIMEOUT:
    'Stopped waiting for work items; the underlying read may still be running',
  GATEWAY_RESPONSE_INVALID:
    'The complete work item response did not match this read or exceeded its size limit',
} as const;
type ErrorCode = keyof typeof messages;
function fail(code: ErrorCode, trace: string) {
  return new ContractError(code, messages[code], { trace_id: trace, retryable: false });
}
function validTrace(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 1024 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  );
}
export function isWorkItemReadTool(name: unknown): name is ToolName {
  return name === 'list_work_item_projections' || name === 'get_work_item_projection';
}
export function canReadWorkItemsTool(context: RequestContext): boolean {
  try {
    const expiry = Date.parse(context.token_expires_at ?? '');
    if (
      context.schema_version !== 1 ||
      context.authenticated_client !== true ||
      !Array.isArray(context.capability) ||
      !context.capability.includes('context.read') ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now() ||
      !validTrace(context.trace_id)
    )
      return false;
    parseSyncCommandIdentity({
      tenant_id: context.tenant_id,
      workspace_id: context.workspace_id,
      project_id: context.project_id,
      actor_id: context.actor_id,
      client_id: context.client_id,
    });
    return true;
  } catch {
    return false;
  }
}
function captureQuery(name: string, raw: unknown, trace: string): Query {
  try {
    if (!isWorkItemReadTool(name)) throw new TypeError();
    const value: unknown = JSON.parse(syncJsonSnapshot(raw, 8192));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    if (name === 'get_work_item_projection')
      return { kind: 'detail', value: parseWorkItemProjectionQuery(value) };
    const row = value as Record<string, unknown>;
    // These optional schema fields must be omitted rather than supplied as empty enum/owner values.
    if (['status', 'priority', 'owner', 'assignment'].some((key) => row[key] === ''))
      throw new TypeError();
    return { kind: 'list', value: parseWorkItemListQuery(row) };
  } catch {
    throw fail('INVALID_INPUT', trace);
  }
}

export function prepareWorkItemReadTool(
  name: string,
  raw: unknown,
  original: RequestContext,
): HttpRequest {
  const trace = validTrace(original.trace_id) ? original.trace_id : 'trace_unknown';
  let context: RequestContext;
  try {
    context = structuredClone(original);
  } catch {
    throw fail('DENIED', trace);
  }
  if (!canReadWorkItemsTool(context)) throw fail('DENIED', trace);
  const query = captureQuery(name, raw, trace);
  delete context.idempotency_key;
  delete context.expected_version;
  Reflect.deleteProperty(context, 'if_match');
  return {
    method: 'POST',
    path: '/v1/workbench/query',
    headers: {},
    context,
    body: { operation: query.kind === 'list' ? 'work_items' : 'work_item', ...query.value },
  };
}

function parseEnvelope(value: unknown, query: Query, context: RequestContext) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  const allowed = [
    'schema_version',
    'trace_id',
    'source_refs',
    'data',
    ...(query.kind === 'list' ? ['next_cursor'] : []),
  ];
  if (
    Object.keys(row).some((key) => !allowed.includes(key)) ||
    row.schema_version !== 1 ||
    row.trace_id !== context.trace_id ||
    !Object.hasOwn(row, 'data') ||
    !Array.isArray(row.source_refs)
  )
    throw new TypeError();
  const source_refs = row.source_refs.map(validateSourceRef);
  const result =
    query.kind === 'list'
      ? parseWorkItemProjectionList(row, query.value)
      : { data: parseWorkItemProjection(row.data, query.value.item_id) };
  // The wire projection does not require a scope echo. If one is present, reject mismatches.
  const originals = Array.isArray(row.data) ? row.data : [row.data];
  for (const item of originals) {
    const record = item as Record<string, unknown>;
    for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (Object.hasOwn(record, field) && record[field] !== context[field]) throw new TypeError();
  }
  const items = Array.isArray(result.data) ? result.data : [result.data];
  if (
    !context.capability.includes('data.restricted.read') &&
    items.some((item) => item.classification === 'restricted')
  )
    throw fail('DENIED', context.trace_id);
  return { schema_version: 1 as const, trace_id: context.trace_id, source_refs, ...result };
}

/** One complete read; timed-out operations retain their slot until actual settlement. */
export async function executeWorkItemReadTool(
  api: ApiGateway,
  name: string,
  raw: unknown,
  original: RequestContext,
) {
  const deadline = performance.now() + 30_000;
  const request = prepareWorkItemReadTool(name, raw, original);
  const context = request.context;
  const trace = context.trace_id;
  const { operation: _operation, ...fields } = request.body!;
  const query = captureQuery(name, fields, trace);
  const active = () => {
    if (performance.now() >= deadline) throw fail('MCP_WORK_ITEM_READ_TIMEOUT', trace);
    if (!canReadWorkItemsTool(context)) throw fail('DENIED', trace);
  };
  active();
  let gate = activeReads.get(api);
  if (!gate) {
    gate = { active: 0 };
    activeReads.set(api, gate);
  }
  if (gate.active >= 2) throw fail('MCP_WORK_ITEM_READ_BUSY', trace);
  const lease = gate;
  lease.active++;
  const work = (async () => {
    try {
      active();
      // Keep the validation query and authority private from the handler's mutable request.
      const response = await api.handle(structuredClone(request));
      active();
      if (
        (response.status !== 200 &&
          (!Number.isInteger(response.status) || response.status < 400 || response.status > 599)) ||
        response.headers['x-trace-id'] !== trace ||
        response.headers.etag !== undefined ||
        !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
          response.headers['content-type'] ?? '',
        )
      )
        throw fail('GATEWAY_RESPONSE_INVALID', trace);
      const value: unknown = JSON.parse(
        syncJsonSnapshot(response.body, response.status >= 400 ? 16 * 1024 : responseBytes),
      );
      if (response.status >= 400) {
        const error = validateErrorEnvelope(value);
        if (error.trace_id !== trace) throw fail('GATEWAY_RESPONSE_INVALID', trace);
        throw fail(
          Object.hasOwn(messages, error.code)
            ? (error.code as ErrorCode)
            : 'GATEWAY_RESPONSE_INVALID',
          trace,
        );
      }
      const envelope = parseEnvelope(value, query, context);
      active();
      const text = syncJsonSnapshot(envelope, responseBytes);
      const result = { content: [{ type: 'text' as const, text }] };
      syncJsonSnapshot(result, 2 * responseBytes + 4096);
      active();
      return result;
    } catch (error) {
      let stopped = error;
      try {
        active();
      } catch (error) {
        stopped = error;
      }
      const envelope = stopped instanceof ContractError ? stopped.envelope : undefined;
      throw fail(
        envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
          ? (envelope.code as ErrorCode)
          : 'GATEWAY_RESPONSE_INVALID',
        trace,
      );
    } finally {
      lease.active--;
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(fail('MCP_WORK_ITEM_READ_TIMEOUT', trace)),
          Math.max(1, deadline - performance.now()),
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
