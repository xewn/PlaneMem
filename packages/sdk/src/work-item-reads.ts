import {
  ContractError,
  isSyncIdentifier,
  parseWorkItemListQuery,
  parseWorkItemProjection,
  parseWorkItemProjectionList,
  parseWorkItemProjectionQuery,
  syncJsonSnapshot,
  validateSourceRef,
  type RequestContext,
  type WorkItemListQuery,
  type WorkItemProjection,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import type { WcpEnvelope } from './continuity.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpWorkItemReadOptions {
  /** Per-request wait, including transport and complete response validation. Defaults to 30 seconds. */
  timeout_ms?: number;
  signal?: AbortSignal;
}

export interface WcpWorkItemPagesOptions extends WcpWorkItemReadOptions {
  /** Defaults to 100, at most 1000. Further continuation raises WORK_ITEM_PAGE_LIMIT. */
  max_pages?: number;
}

const responseBytes = 2 * 1024 * 1024;
const queryFields = [
  'query',
  'sort',
  'status',
  'priority',
  'owner',
  'assignment',
  'due',
  'due_from',
  'due_before',
  'cursor',
  'limit',
];
const messages = {
  INVALID_INPUT: 'Supply valid work item filters or a local ID, project scope and read options',
  DENIED: 'The current account or client cannot read these work items',
  UNAUTHENTICATED: 'Renew the intended session before continuing the work item read',
  WORK_ITEM_NOT_FOUND: 'The requested work item is unavailable in this project',
  WORK_ITEM_PROJECTION_INVALID: 'The stored work item response is invalid',
  WORKBENCH_DATABASE_UNAVAILABLE: 'The work item projection store is unavailable',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The work item read audit could not be persisted',
  MOCK_ROUTE_NOT_FOUND: 'The configured Mock does not provide this work item read',
  MOCK_WORK_ITEM_INTEGRITY_UNAVAILABLE: 'The simulated work item cursor could not be bound',
  RATE_LIMITED: 'Work item read capacity is occupied',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for work items',
  GATEWAY_REQUEST_TIMEOUT: 'The work item read exceeded its local deadline',
  GATEWAY_RESPONSE_INVALID: 'The complete work item response is invalid or exceeds its size limit',
  GATEWAY_UNAVAILABLE: 'The work item read could not be completed',
  WORK_ITEM_PAGE_LIMIT:
    'The requested page limit was reached; preserve the last complete page and its continuation',
} as const;
type ErrorCode = keyof typeof messages;
function failure(code: ErrorCode, trace: string) {
  return new ContractError(code, messages[code], { trace_id: trace, retryable: false });
}

/** Flat inputs may omit optional values with undefined, but cannot run accessors during capture. */
function fields(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const prototype: unknown = Object.getPrototypeOf(value);
  const keys = Object.keys(value);
  if (
    (prototype !== null && prototype !== Object.prototype) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some(
      (key) =>
        !allowed.includes(key) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'),
    )
  )
    throw new TypeError();
  return Object.fromEntries(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(value, key)!.value]),
  );
}
function validText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 1024 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  );
}

function prepare(original: RequestContext, options: WcpWorkItemPagesOptions, pages = false) {
  const context = { ...original };
  try {
    if (
      !validText(context.trace_id) ||
      [context.tenant_id, context.workspace_id, context.project_id].some(
        (id) => !isSyncIdentifier(id) || id === '.' || id === '..',
      ) ||
      (context.actor_id !== undefined && !validText(context.actor_id)) ||
      (context.client_id !== undefined && !validText(context.client_id))
    )
      throw new TypeError();
    const row = fields(
      options,
      pages ? ['timeout_ms', 'signal', 'max_pages'] : ['timeout_ms', 'signal'],
    );
    const timeout = row.timeout_ms === undefined ? 30_000 : row.timeout_ms;
    const maximum = row.max_pages === undefined ? 100 : row.max_pages;
    const signal = row.signal as AbortSignal | undefined;
    if (
      typeof timeout !== 'number' ||
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 2_147_483_647 ||
      typeof maximum !== 'number' ||
      !Number.isSafeInteger(maximum) ||
      maximum < 1 ||
      maximum > 1000 ||
      (signal !== undefined &&
        (!signal ||
          typeof signal !== 'object' ||
          typeof signal.aborted !== 'boolean' ||
          typeof signal.addEventListener !== 'function' ||
          typeof signal.removeEventListener !== 'function'))
    )
      throw new TypeError();
    return { context, timeout, signal, maximum };
  } catch {
    throw failure('INVALID_INPUT', context.trace_id);
  }
}
type Prepared = ReturnType<typeof prepare>;

function listQuery(input: WorkItemListQuery, trace: string) {
  try {
    return parseWorkItemListQuery(fields(input, queryFields));
  } catch {
    throw failure('INVALID_INPUT', trace);
  }
}

function scopeIfPresent(value: unknown, context: RequestContext) {
  if (!value || typeof value !== 'object') throw new TypeError();
  const row = value as Record<string, unknown>;
  for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (Object.hasOwn(row, key) && row[key] !== context[key]) throw new TypeError();
}

async function read<T>(
  transport: WcpTransport,
  prepared: Prepared,
  body: Record<string, unknown>,
  parse: (raw: Record<string, unknown>) => WcpEnvelope<T>,
): Promise<WcpEnvelope<T>> {
  const { context, timeout, signal } = prepared;
  const trace = context.trace_id;
  let budget: RequestBudget;
  let capturedBody: unknown;
  try {
    capturedBody = JSON.parse(syncJsonSnapshot(body, 8192));
    budget = createRequestBudget(trace, timeout, signal);
  } catch {
    throw failure('INVALID_INPUT', trace);
  }
  try {
    const raw = await budget.wait(() =>
      transport.request({
        method: 'POST',
        path: '/v1/workbench/query',
        body: capturedBody,
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': context.tenant_id,
          'x-workspace-id': context.workspace_id,
          'x-project-id': context.project_id!,
          ...(context.actor_id === undefined ? {} : { 'x-expected-actor-id': context.actor_id }),
          ...(context.client_id === undefined ? {} : { 'x-expected-client-id': context.client_id }),
        },
        response_type: 'bounded-json',
        max_response_bytes: responseBytes,
        signal: budget.signal,
      }),
    );
    let result: WcpEnvelope<T>;
    try {
      const row = fields(
        JSON.parse(syncJsonSnapshot(raw, responseBytes)),
        body.operation === 'work_items'
          ? ['schema_version', 'trace_id', 'source_refs', 'data', 'next_cursor']
          : ['schema_version', 'trace_id', 'source_refs', 'data'],
      );
      if (
        row.schema_version !== 1 ||
        row.trace_id !== trace ||
        !Array.isArray(row.source_refs) ||
        !Object.hasOwn(row, 'data')
      )
        throw new TypeError();
      row.source_refs.forEach(validateSourceRef);
      result = parse(row);
    } catch {
      budget.check();
      throw failure('GATEWAY_RESPONSE_INVALID', trace);
    }
    budget.check();
    return result;
  } catch (error) {
    let stopped = error;
    try {
      budget.check();
    } catch (error) {
      stopped = error;
    }
    const envelope = stopped instanceof ContractError ? stopped.envelope : undefined;
    throw failure(
      envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
        ? (envelope.code as ErrorCode)
        : 'GATEWAY_UNAVAILABLE',
      trace,
    );
  } finally {
    try {
      budget.close();
    } catch {
      /* Cleanup cannot replace a validated response or failure. */
    }
  }
}

function readPage(transport: WcpTransport, prepared: Prepared, query: WorkItemListQuery) {
  // The request body is detached separately from the query retained for response validation.
  return read<WorkItemProjection[]>(
    transport,
    prepared,
    { operation: 'work_items', ...query },
    (raw) => {
      const page = parseWorkItemProjectionList(raw, query);
      for (const item of raw.data as unknown[]) scopeIfPresent(item, prepared.context);
      return {
        schema_version: 1,
        trace_id: prepared.context.trace_id,
        source_refs: raw.source_refs as WcpEnvelope<unknown>['source_refs'],
        ...page,
      };
    },
  );
}

export async function readWorkItems(
  transport: WcpTransport,
  context: RequestContext,
  input: WorkItemListQuery,
  options: WcpWorkItemReadOptions,
) {
  const prepared = prepare(context, options);
  return readPage(transport, prepared, listQuery(input, prepared.context.trace_id));
}

export async function readWorkItem(
  transport: WcpTransport,
  context: RequestContext,
  itemId: string,
  options: WcpWorkItemReadOptions,
) {
  const prepared = prepare(context, options);
  let query;
  try {
    query = parseWorkItemProjectionQuery({ item_id: itemId });
  } catch {
    throw failure('INVALID_INPUT', prepared.context.trace_id);
  }
  return read<WorkItemProjection>(
    transport,
    prepared,
    { operation: 'work_item', ...query },
    (raw) => {
      scopeIfPresent(raw.data, prepared.context);
      return {
        schema_version: 1,
        trace_id: prepared.context.trace_id,
        source_refs: raw.source_refs as WcpEnvelope<unknown>['source_refs'],
        data: parseWorkItemProjection(raw.data, query.item_id),
      };
    },
  );
}

/** No transport/timer until next(); retain continuation privately before yielding mutable data. */
export function iterateWorkItems(
  transport: WcpTransport,
  context: RequestContext,
  input: WorkItemListQuery,
  options: WcpWorkItemPagesOptions,
) {
  const prepared = prepare(context, options, true);
  const query = listQuery(input, prepared.context.trace_id);
  return (async function* () {
    let cursor = query.cursor;
    const visited = new Set<string>(cursor === undefined ? [] : [cursor]);
    for (let count = 0; ; count++) {
      if (count >= prepared.maximum)
        throw failure('WORK_ITEM_PAGE_LIMIT', prepared.context.trace_id);
      const current = { ...query };
      if (cursor === undefined) delete current.cursor;
      else current.cursor = cursor;
      const page = await readPage(transport, prepared, current);
      const next = page.next_cursor;
      if (next !== undefined) {
        if (visited.has(next)) throw failure('GATEWAY_RESPONSE_INVALID', prepared.context.trace_id);
        visited.add(next);
      }
      yield page;
      if (next === undefined) return;
      cursor = next;
    }
  })();
}
