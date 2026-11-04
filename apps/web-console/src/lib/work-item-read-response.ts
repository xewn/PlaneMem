import {
  ContractError,
  parseWorkItemListQuery,
  parseWorkItemProjection,
  parseWorkItemProjectionList,
  parseWorkItemProjectionQuery,
  syncJsonSnapshot,
  validateErrorEnvelope,
  validateSourceRef,
  type WorkItemProjection,
} from '@planemem/contracts';
import type { WorkbenchResponse } from './server-api';
import { readWorkbenchJsonResponse } from './workbench-response';

const messages: Record<string, string> = {
  INVALID_INPUT:
    'The work item query was rejected. For a saved page, start again from the first page with the same filters.',
  DENIED: 'Your current session cannot read work items in this project.',
  WORK_ITEM_NOT_FOUND: 'This work item is unavailable in the selected project.',
  WORK_ITEM_PROJECTION_INVALID: 'The saved work item information could not be validated.',
  WORKBENCH_DATABASE_UNAVAILABLE: 'Work item information is temporarily unavailable.',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is temporarily unavailable.',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The work item read audit could not be persisted.',
  RATE_LIMITED: 'Work item reads are temporarily busy. Retry this page when ready.',
  GATEWAY_REQUEST_TIMEOUT:
    'Work item information exceeded the local read deadline. Retry when ready.',
  GATEWAY_RESPONSE_INVALID:
    'The complete work item response was invalid, incomplete or exceeded its read limit.',
  GATEWAY_UNAVAILABLE: 'Work item information could not be read. Retry when ready.',
};

export function workItemReadFailure(code: string, trace: string) {
  const known = Object.hasOwn(messages, code) ? code : 'GATEWAY_UNAVAILABLE';
  return new ContractError(known, messages[known]!, { trace_id: trace, retryable: false });
}

/** Capture a normalized query before any session or network wait; no inherited write fields. */
export function prepareWorkItemReadBody(body: Record<string, unknown>): Record<string, unknown> {
  const { operation, ...input } = body;
  const query =
    operation === 'work_items'
      ? parseWorkItemListQuery(input)
      : operation === 'work_item'
        ? parseWorkItemProjectionQuery(input)
        : undefined;
  if (!query) throw new TypeError('Choose a work item list or detail read.');
  return JSON.parse(syncJsonSnapshot({ operation, ...query }, 8192)) as Record<string, unknown>;
}

/** Read and validate the entire page/detail inside the request's existing deadline. */
export async function readWorkItemResponse(
  response: Response,
  signal: AbortSignal,
  trace: string,
  deadline: number,
  body: Record<string, unknown>,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
): Promise<WorkbenchResponse<WorkItemProjection[] | WorkItemProjection>> {
  const fail = (code: string) => workItemReadFailure(code, trace);
  const check = () => {
    if (signal.aborted || Date.now() >= deadline) throw fail('GATEWAY_REQUEST_TIMEOUT');
  };
  let value: unknown;
  try {
    check();
    if (
      (response.status !== 200 && (response.status < 400 || response.status > 599)) ||
      response.headers.get('x-trace-id') !== trace ||
      response.headers.has('etag')
    )
      throw new TypeError();
    value = await readWorkbenchJsonResponse(response, signal, 2 * 1024 * 1024, 16 * 1024);
    // Also bound ordinary JSON depth, node count and its normalized representation.
    syncJsonSnapshot(value, response.ok ? 2 * 1024 * 1024 : 16 * 1024);
  } catch {
    void response.body?.cancel().catch(() => undefined);
    check();
    throw fail('GATEWAY_RESPONSE_INVALID');
  }
  check();
  if (!response.ok) {
    let code: string;
    try {
      const error = validateErrorEnvelope(value);
      if (error.trace_id !== trace) throw new TypeError();
      code = error.code;
    } catch {
      check();
      throw fail('GATEWAY_RESPONSE_INVALID');
    }
    check();
    throw fail(code);
  }
  let result: WorkbenchResponse<WorkItemProjection[] | WorkItemProjection>;
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const row = value as Record<string, unknown>;
    const { operation, ...input } = body;
    const list = operation === 'work_items';
    const fields = ['schema_version', 'trace_id', 'source_refs', 'data'];
    if (list) fields.push('next_cursor');
    if (
      Object.keys(row).some((key) => !fields.includes(key)) ||
      row.schema_version !== 1 ||
      row.trace_id !== trace ||
      !Object.hasOwn(row, 'data') ||
      !Array.isArray(row.source_refs)
    )
      throw new TypeError();
    const source_refs = row.source_refs.map((raw: unknown) => {
      const ref = validateSourceRef(raw);
      return {
        type: ref.type,
        id: ref.id,
        ...(ref.revision === undefined ? {} : { revision: ref.revision }),
        ...(ref.uri === undefined ? {} : { uri: ref.uri }),
      };
    });
    const page = list
      ? parseWorkItemProjectionList(row, parseWorkItemListQuery(input))
      : { data: parseWorkItemProjection(row.data, parseWorkItemProjectionQuery(input).item_id) };
    const records = list ? (row.data as unknown[]) : [row.data];
    for (const record of records) {
      const item = record as Record<string, unknown>;
      for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const)
        if (Object.hasOwn(item, key) && item[key] !== scope[key]) throw new TypeError();
    }
    result = { schema_version: 1, trace_id: trace, source_refs, ...page };
  } catch {
    check();
    throw fail('GATEWAY_RESPONSE_INVALID');
  }
  check();
  return result;
}
