import { isUlid } from './ids.js';
import { validateSourceRef, type SourceRef } from './metadata.js';

/** Verified caller binding for recovery, never an authentication credential. */
export interface SessionCommandIdentity {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  actor_id: string;
  client_id: string;
}

export function parseSessionCommandIdentity(value: unknown): SessionCommandIdentity {
  const row = object(value);
  const fields = ['tenant_id', 'workspace_id', 'project_id', 'actor_id', 'client_id'];
  if (Object.keys(row).some((key) => !fields.includes(key)))
    throw new TypeError('Unknown session identity field');
  for (const key of fields) {
    const field = row[key];
    if (
      typeof field !== 'string' ||
      !field.trim() ||
      field.length > 1024 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(field)
    )
      throw new TypeError('Invalid session command identity');
  }
  return {
    tenant_id: row.tenant_id as string,
    workspace_id: row.workspace_id as string,
    project_id: row.project_id as string,
    actor_id: row.actor_id as string,
    client_id: row.client_id as string,
  };
}

export interface SessionRunQuery {
  before_sequence?: number;
  limit?: number;
}
export interface SessionToolCallQuery {
  run_id?: string;
  before_id?: string;
  limit?: number;
}
export interface SessionActivitySession {
  session_id: string;
  status: 'running' | 'paused' | 'ended' | 'abandoned' | 'failed';
  version: number;
}
export interface SessionClosureState extends SessionActivitySession {
  ended_at: string | null;
}

/** Current state for review, never proof that a particular close request committed. */
export function parseSessionClosureState(value: unknown, sessionId: string): SessionClosureState {
  const row = object(value);
  if (
    !isUlid(sessionId) ||
    row.session_id !== sessionId ||
    Object.keys(row).some(
      (key) => !['session_id', 'status', 'version', 'ended_at'].includes(key),
    ) ||
    typeof row.status !== 'string' ||
    !['running', 'paused', 'ended', 'abandoned', 'failed'].includes(row.status) ||
    !positive(row.version)
  )
    throw new TypeError('Invalid session state');
  const terminal = ['ended', 'abandoned', 'failed'].includes(row.status);
  if (terminal) {
    if (
      typeof row.ended_at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.ended_at) ||
      !Number.isFinite(Date.parse(row.ended_at)) ||
      new Date(row.ended_at).toISOString() !== row.ended_at
    )
      throw new TypeError('Invalid session closure time');
  } else if (row.ended_at !== null)
    throw new TypeError('Active session cannot have a closure time');
  return {
    session_id: sessionId,
    status: row.status as SessionActivitySession['status'],
    version: row.version,
    ended_at: row.ended_at as string | null,
  };
}
export interface SessionRunRecord {
  run_id: string;
  session_id: string;
  sequence: number;
  model?: string;
  status: 'running' | 'completed' | 'failed';
  version: number;
  trace_id: string;
  source_refs: SourceRef[];
}
export interface SessionToolCallRecord {
  tool_call_id: string;
  session_id: string;
  run_id: string;
  tool_name: string;
  status: 'started' | 'succeeded' | 'failed';
  version: number;
  trace_id: string;
  source_refs: SourceRef[];
}
export interface SessionRunPage {
  session: SessionActivitySession;
  runs: SessionRunRecord[];
  next_before_sequence?: number;
}
export interface SessionRunDetail {
  session: SessionActivitySession;
  run: SessionRunRecord;
}
export interface SessionToolCallPage {
  session: SessionActivitySession;
  run_id?: string;
  tool_calls: SessionToolCallRecord[];
  next_before_id?: string;
}
export interface SessionToolCallDetail {
  session: SessionActivitySession;
  run: SessionRunRecord;
  tool_call: SessionToolCallRecord;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected an object');
  return value as Record<string, unknown>;
}
function positive(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= max;
}
function limit(value: unknown): number {
  if (value === undefined) return 25;
  if (!positive(value, 100)) throw new TypeError('limit must be between 1 and 100');
  return value;
}
export function parseSessionRunQuery(value: unknown): SessionRunQuery & { limit: number } {
  const query = object(value);
  if (Object.keys(query).some((key) => !['before_sequence', 'limit'].includes(key)))
    throw new TypeError('Unknown run query field');
  if (query.before_sequence !== undefined && !positive(query.before_sequence, 2147483647))
    throw new TypeError('before_sequence must be a positive run sequence');
  return {
    limit: limit(query.limit),
    ...(query.before_sequence === undefined
      ? {}
      : { before_sequence: query.before_sequence as number }),
  };
}
export function parseSessionToolCallQuery(
  value: unknown,
): SessionToolCallQuery & { limit: number } {
  const query = object(value);
  if (Object.keys(query).some((key) => !['run_id', 'before_id', 'limit'].includes(key)))
    throw new TypeError('Unknown tool call query field');
  for (const key of ['run_id', 'before_id'])
    if (query[key] !== undefined && !isUlid(query[key]))
      throw new TypeError(`${key} must be a ULID`);
  return {
    limit: limit(query.limit),
    ...(query.run_id === undefined ? {} : { run_id: query.run_id as string }),
    ...(query.before_id === undefined ? {} : { before_id: query.before_id as string }),
  };
}
function session(value: unknown, id: string): SessionActivitySession {
  const item = object(value);
  if (
    item.session_id !== id ||
    !isUlid(id) ||
    !positive(item.version) ||
    !['running', 'paused', 'ended', 'abandoned', 'failed'].includes(item.status as string)
  )
    throw new TypeError('Invalid activity session');
  return {
    session_id: id,
    status: item.status as SessionActivitySession['status'],
    version: item.version,
  };
}
function metadata(item: Record<string, unknown>, sessionId: string) {
  if (
    item.session_id !== sessionId ||
    !positive(item.version) ||
    typeof item.trace_id !== 'string' ||
    !item.trace_id ||
    !Array.isArray(item.source_refs)
  )
    throw new TypeError('Invalid activity record');
  return {
    session_id: sessionId,
    version: item.version,
    trace_id: item.trace_id,
    source_refs: item.source_refs.map((ref) => ({ ...validateSourceRef(ref) })),
  };
}
export function parseSessionRunPage(
  value: unknown,
  sessionId: string,
  input: SessionRunQuery = {},
): SessionRunPage {
  const query = parseSessionRunQuery(input);
  const page = object(value);
  const header = session(page.session, sessionId);
  if (!Array.isArray(page.runs) || page.runs.length > query.limit)
    throw new TypeError('Invalid run page');
  let before = query.before_sequence ?? 2147483648;
  const ids = new Set<string>();
  const runs = page.runs.map((raw): SessionRunRecord => {
    const item = object(raw);
    if (
      !isUlid(item.run_id) ||
      ids.has(item.run_id) ||
      !positive(item.sequence, 2147483647) ||
      item.sequence >= before ||
      !['running', 'completed', 'failed'].includes(item.status as string) ||
      (item.model !== undefined && typeof item.model !== 'string')
    )
      throw new TypeError('Invalid run record');
    ids.add(item.run_id);
    before = item.sequence;
    return {
      ...metadata(item, sessionId),
      run_id: item.run_id,
      sequence: item.sequence,
      status: item.status as SessionRunRecord['status'],
      ...(item.model === undefined ? {} : { model: item.model as string }),
    };
  });
  if (
    page.next_before_sequence !== undefined &&
    (runs.length !== query.limit || page.next_before_sequence !== runs.at(-1)?.sequence)
  )
    throw new TypeError('Invalid run continuation');
  return {
    session: header,
    runs,
    ...(page.next_before_sequence === undefined
      ? {}
      : { next_before_sequence: page.next_before_sequence as number }),
  };
}
/** A single run is addressable independently of changing list pagination. */
export function parseSessionRunDetail(
  value: unknown,
  sessionId: string,
  runId: string,
): SessionRunDetail {
  const detail = object(value);
  const page = parseSessionRunPage({ session: detail.session, runs: [detail.run] }, sessionId, {
    limit: 1,
  });
  const run = page.runs[0]!;
  if (!isUlid(runId) || run.run_id !== runId) throw new TypeError('Invalid requested run');
  return { session: page.session, run };
}
export function parseSessionToolCallDetail(
  value: unknown,
  sessionId: string,
  toolCallId: string,
): SessionToolCallDetail {
  const detail = object(value);
  const rawTool = object(detail.tool_call);
  if (!isUlid(toolCallId) || rawTool.tool_call_id !== toolCallId || !isUlid(rawTool.run_id))
    throw new TypeError('Invalid requested tool call');
  const parent = parseSessionRunDetail(
    { session: detail.session, run: detail.run },
    sessionId,
    rawTool.run_id,
  );
  const page = parseSessionToolCallPage(
    { session: detail.session, run_id: parent.run.run_id, tool_calls: [rawTool] },
    sessionId,
    { run_id: parent.run.run_id, limit: 1 },
  );
  return { ...parent, tool_call: page.tool_calls[0]! };
}

export function parseSessionToolCallPage(
  value: unknown,
  sessionId: string,
  input: SessionToolCallQuery = {},
): SessionToolCallPage {
  const query = parseSessionToolCallQuery(input);
  const page = object(value);
  const header = session(page.session, sessionId);
  if (
    page.run_id !== query.run_id ||
    !Array.isArray(page.tool_calls) ||
    page.tool_calls.length > query.limit
  )
    throw new TypeError('Invalid tool call page');
  let before = query.before_id;
  const tool_calls = page.tool_calls.map((raw): SessionToolCallRecord => {
    const item = object(raw);
    if (
      !isUlid(item.tool_call_id) ||
      (before !== undefined && item.tool_call_id >= before) ||
      !isUlid(item.run_id) ||
      (query.run_id !== undefined && item.run_id !== query.run_id) ||
      typeof item.tool_name !== 'string' ||
      !item.tool_name ||
      !['started', 'succeeded', 'failed'].includes(item.status as string)
    )
      throw new TypeError('Invalid tool call record');
    before = item.tool_call_id;
    return {
      ...metadata(item, sessionId),
      tool_call_id: item.tool_call_id,
      run_id: item.run_id,
      tool_name: item.tool_name,
      status: item.status as SessionToolCallRecord['status'],
    };
  });
  if (
    page.next_before_id !== undefined &&
    (tool_calls.length !== query.limit || page.next_before_id !== tool_calls.at(-1)?.tool_call_id)
  )
    throw new TypeError('Invalid tool continuation');
  return {
    session: header,
    tool_calls,
    ...(query.run_id === undefined ? {} : { run_id: query.run_id }),
    ...(page.next_before_id === undefined ? {} : { next_before_id: page.next_before_id as string }),
  };
}
