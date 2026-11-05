import {
  ContractError,
  assertSessionStartCurrent,
  buildEtag,
  createUlid,
  isUlid,
  parseEtag,
  parseContextPackReadEnvelope,
  parseSessionActivityCreateCommand,
  parseSessionActivityCreateEnvelope,
  parseSessionCommandBinding,
  parseSessionCommandContextEnvelope,
  parseSessionCommandIdentity,
  parseSessionCommandReceiptEnvelope,
  parseSessionCommandReceiptLookup,
  parseSessionCommandReceiptQuery,
  parseSessionFinishCommand,
  parseSessionFinishEnvelope,
  parseSessionRunDetail,
  parseSessionRunPage,
  parseSessionRunQuery,
  parseSessionStartBinding,
  parseSessionStartEnvelope,
  parseSessionStartReceiptQuery,
  parseSessionStateEnvelope,
  parseSessionToolCallDetail,
  parseSessionToolCallPage,
  parseSessionToolCallQuery,
  prepareSessionMutation,
  readSessionMutationReceipt,
  validateIdempotencyKey,
  type SessionCommandContextData,
  type SessionCommandReceiptQuery,
  type SessionMutationCommand,
  type SessionMutationResult,
  type SessionMutationRun,
  type SessionMutationScope,
  type SessionMutationSession,
  type SessionMutationToolCall,
  type SessionStartRecorded,
  type Ulid,
} from '@planemem/contracts';
import type { WcpRequest, WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';
import { envelope, fail, fingerprint, object, snapshot } from './mock-session-json.js';
import {
  handleMockSessionContinuity,
  isMockSessionContinuityPath,
  type ContinuityStored,
} from './mock-session-continuity.js';
import type { MockContextPackStore, MockContextPackSession } from './mock-context-packs.js';

export interface MockSessionStoreOptions {
  scope: { tenant_id: string; workspace_id: string; project_id: string };
  context_packs?: MockContextPackStore;
}

/** Explicit simulated authority. No credentials or production identity checks are performed. */
export interface MockSessionAccess extends SessionCommandContextData {
  project_readable: boolean;
  /** New sessions created by this connection are also visible to this connection. */
  visible_session_ids: 'all' | string[];
  /** Explicit saved-pack access; identity and expiry always come from this connection. */
  context_packs?: Omit<MockContextPackSession, 'identity' | 'expires_at'>;
}

type Access = MockSessionAccess & { visible: 'all' | Set<string>; packs?: WcpTransport };
export type MockSessionStored =
  | ContinuityStored
  | { kind: 'session'; value: SessionMutationSession }
  | { kind: 'run'; value: SessionMutationRun }
  | { kind: 'tool'; value: SessionMutationToolCall }
  | { kind: 'start'; fingerprint: string; receipt: SessionStartRecorded }
  | { kind: 'command'; fingerprint: string; result: SessionMutationResult };
type Stored = MockSessionStored;
export type MockSessionChange = { key: string; value: Stored };
type Change = MockSessionChange;
type Request = WcpRequest & { headers: Record<string, string> };
const MAX_REQUEST = 16 * 1024;
const MAX_RESPONSE = 2 * 1024 * 1024;
const CONTINUITY_REQUEST = 1024 * 1024;
const CONTINUITY_RESPONSE = 8 * 1024 * 1024;
const MAX_RECORDS = 10_000;
const MAX_STORE_BYTES = 16 * 1024 * 1024;
const configurationTrace = 'trace_mock_session_configuration';

function scopeOf(identity: MockSessionAccess['identity']): SessionMutationScope {
  const { tenant_id, workspace_id, project_id } = identity;
  if (!isUlid(tenant_id) || !isUlid(workspace_id) || !isUlid(project_id)) throw new TypeError();
  return { tenant_id, workspace_id, project_id };
}
function commandResult(result: SessionMutationResult, trace: string) {
  const data =
    'run' in result ? result.run : 'tool_call' in result ? result.tool_call : result.session;
  return { ...envelope(data, trace, data.source_refs), etag: buildEtag(data.version) };
}
function receiptResult(result: SessionMutationResult, query: SessionCommandReceiptQuery) {
  const base = {
    status: 'recorded',
    operation: result.kind,
    session_id: result.session.session_id,
    session_version: result.session.version,
  };
  const details =
    result.kind === 'run.start'
      ? { run_id: result.run.run_id, sequence: result.run.sequence }
      : result.kind === 'run.finish'
        ? {
            run_id: result.run.run_id,
            run_version: result.run.version,
            run_status: result.run.status,
            changed: result.changed,
          }
        : result.kind === 'tool.call'
          ? { run_id: result.tool_call.run_id, tool_call_id: result.tool_call.tool_call_id }
          : result.kind === 'tool.finish'
            ? {
                run_id: result.tool_call.run_id,
                tool_call_id: result.tool_call.tool_call_id,
                tool_version: result.tool_call.version,
                tool_status: result.tool_call.status,
                changed: result.changed,
              }
            : { ended_status: result.session.status };
  return parseSessionCommandReceiptLookup(
    { ...base, ...details },
    result.session.session_id,
    query,
  );
}
function mutation(
  query: SessionCommandReceiptQuery,
  session_id: Ulid,
  scope: SessionMutationScope,
  trace_id: string,
): SessionMutationCommand {
  const row = query.command;
  const input = { ...scope, session_id, expected_version: row.expected_version, trace_id };
  switch (query.operation) {
    case 'run.start':
      return {
        kind: 'run.start',
        input: { ...input, ...(typeof row.model === 'string' ? { model: row.model } : {}) },
      };
    case 'tool.call':
      return {
        kind: 'tool.call',
        input: {
          ...input,
          run_id: row.run_id as Ulid,
          tool_name: row.tool_name as string,
          status: row.status as SessionMutationToolCall['status'],
        },
      };
    case 'run.finish':
      return {
        kind: 'run.finish',
        input: {
          ...input,
          run_id: row.run_id as Ulid,
          expected_run_version: row.expected_run_version as number,
          status: row.status as 'completed' | 'failed',
        },
      };
    case 'tool.finish':
      return {
        kind: 'tool.finish',
        input: {
          ...input,
          tool_call_id: row.tool_call_id as Ulid,
          expected_tool_version: row.expected_tool_version as number,
          status: row.status as 'succeeded' | 'failed',
        },
      };
    case 'end':
      return {
        kind: 'end',
        input: { ...input, status: row.status as 'ended' | 'abandoned' | 'failed' },
      };
  }
}

export function isMockSessionPath(path: unknown): path is string {
  return typeof path === 'string' && /^\/v1\/(?:sessions|handoffs)(?:[/?#]|$)/.test(path);
}

/** In-memory lifecycle and original receipts shared by explicitly connected simulated callers. */
export class MockSessionStore {
  private readonly scope: SessionMutationScope;
  private readonly contextPacks: MockContextPackStore | undefined;
  private readonly records = new Map<string, Stored>();
  private storedBytes = 0;

  constructor(options: MockSessionStoreOptions) {
    try {
      const { context_packs, ...configuration } = options;
      this.contextPacks = context_packs;
      const raw = object(snapshot(configuration, MAX_REQUEST));
      if (Object.keys(raw).some((key) => key !== 'scope')) throw new TypeError();
      const scope = object(raw.scope);
      if (
        Object.keys(scope).some((key) => !['tenant_id', 'workspace_id', 'project_id'].includes(key))
      )
        throw new TypeError();
      this.scope = scopeOf(
        parseSessionCommandIdentity({ ...scope, actor_id: 'mock', client_id: 'mock' }),
      );
    } catch {
      fail('MOCK_SESSION_CONFIGURATION_INVALID', configurationTrace);
    }
  }

  connect(input: MockSessionAccess): WcpTransport {
    let access: Access;
    try {
      const raw = snapshot(input, 128 * 1024);
      if (
        Object.keys(object(raw)).some(
          (key) =>
            ![
              'identity',
              'expires_at',
              'permissions',
              'project_readable',
              'visible_session_ids',
              'context_packs',
            ].includes(key),
        )
      )
        throw new TypeError();
      const data = parseSessionCommandContextEnvelope(
        envelope(
          { identity: raw.identity, expires_at: raw.expires_at, permissions: raw.permissions },
          configurationTrace,
        ),
        this.scope,
        configurationTrace,
      ).data;
      if (
        typeof raw.project_readable !== 'boolean' ||
        (raw.visible_session_ids !== 'all' &&
          (!Array.isArray(raw.visible_session_ids) ||
            raw.visible_session_ids.length > 1000 ||
            raw.visible_session_ids.some((id) => !isUlid(id)) ||
            new Set(raw.visible_session_ids).size !== raw.visible_session_ids.length))
      )
        throw new TypeError();
      if (raw.context_packs !== undefined && !this.contextPacks) throw new TypeError();
      if (
        raw.context_packs !== undefined &&
        Object.keys(object(raw.context_packs)).some(
          (field) =>
            !['project_readable', 'read_context', 'read_restricted', 'visible_pack_ids'].includes(
              field,
            ),
        )
      )
        throw new TypeError();
      access = {
        ...raw,
        ...data,
        visible: raw.visible_session_ids === 'all' ? 'all' : new Set(raw.visible_session_ids),
        ...(raw.context_packs === undefined
          ? {}
          : {
              packs: this.contextPacks!.connect({
                ...raw.context_packs,
                identity: data.identity,
                expires_at: data.expires_at,
              }),
            }),
      };
    } catch {
      fail('MOCK_SESSION_CONFIGURATION_INVALID', configurationTrace);
    }
    return {
      request: async <T>(request: WcpRequest): Promise<T> =>
        (await this.request(request, access)) as T,
    };
  }

  private authorized(access: Access, trace: string) {
    if (Date.parse(access.expires_at) <= Date.now()) fail('DENIED', trace);
  }

  private session(id: string, access: Access, trace: string): SessionMutationSession {
    const row = this.records.get('session:' + id);
    if (
      !access.project_readable ||
      (access.visible !== 'all' && !access.visible.has(id)) ||
      row?.kind !== 'session'
    )
      fail('SESSION_NOT_FOUND', trace);
    return row.value;
  }

  private async request(original: WcpRequest, access: Access): Promise<unknown> {
    let trace = 'trace_unknown';
    const budget = createRequestBudget(trace, 30_000, original.signal);
    try {
      const raw = object(snapshot(original.headers, MAX_REQUEST));
      const headers: Record<string, string> = Object.create(null) as Record<string, string>;
      for (const [name, value] of Object.entries(raw)) {
        const key = name.toLowerCase();
        if (Object.hasOwn(headers, key) || typeof value !== 'string' || /[\r\n\u0000]/.test(value))
          throw new TypeError();
        headers[key] = value;
      }
      trace = headers.traceparent ?? headers['x-trace-id'] ?? trace;
      if (!trace.trim() || trace.length > 512 || /[\u0000-\u001f\u007f\p{Cs}]/u.test(trace))
        throw new TypeError();
      const continuity =
        typeof original.path === 'string' &&
        isMockSessionContinuityPath(original.path.split('?')[0]!);
      const request: Request = {
        method: original.method,
        path: original.path,
        headers,
        ...(original.body === undefined
          ? {}
          : { body: snapshot(original.body, continuity ? CONTINUITY_REQUEST : MAX_REQUEST) }),
        ...(original.response_type === undefined ? {} : { response_type: original.response_type }),
        ...(original.max_response_bytes === undefined
          ? {}
          : { max_response_bytes: original.max_response_bytes }),
      };
      if (
        !['json', 'bounded-json'].includes(request.response_type ?? 'json') ||
        (request.response_type === 'bounded-json'
          ? !Number.isSafeInteger(request.max_response_bytes) || request.max_response_bytes! < 1
          : request.max_response_bytes !== undefined)
      )
        throw new TypeError();
      if (
        !isMockSessionPath(request.path) ||
        request.path.length > MAX_REQUEST ||
        /[\\#]/.test(request.path)
      )
        throw new TypeError();
      const url = new URL(request.path, 'https://mock.invalid');
      if (url.pathname !== request.path.split('?')[0]) throw new TypeError();
      for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const)
        if (headers['x-' + key.replaceAll('_', '-')] !== this.scope[key]) fail('DENIED', trace);
      for (const key of ['actor_id', 'client_id'] as const)
        if (
          headers['x-expected-' + key.replaceAll('_', '-')] !== undefined &&
          headers['x-expected-' + key.replaceAll('_', '-')] !== access.identity[key]
        )
          fail('DENIED', trace);
      const check = () => {
        budget.check();
        this.authorized(access, trace);
      };
      check();
      const output = (value: unknown) => {
        check();
        let detached: unknown;
        try {
          detached = snapshot(
            value,
            Math.min(
              continuity ? CONTINUITY_RESPONSE : MAX_RESPONSE,
              request.max_response_bytes ?? (continuity ? CONTINUITY_RESPONSE : MAX_RESPONSE),
            ),
          );
        } catch {
          return fail('GATEWAY_RESPONSE_INVALID', trace);
        }
        check();
        return detached;
      };
      const write = (changes: Change[], beforeCommit?: () => void) => {
        check();
        this.commit(changes, trace, () => {
          check();
          beforeCommit?.();
        });
      };
      if (request.method === 'GET' || url.pathname.endsWith('/receipt')) {
        if (
          headers['idempotency-key'] !== undefined ||
          headers['if-match'] !== undefined ||
          headers['if-match-version'] !== undefined
        )
          throw new TypeError();
      }
      if (isMockSessionContinuityPath(url.pathname)) {
        return await budget.wait(() =>
          handleMockSessionContinuity({
            request,
            url,
            scope: this.scope,
            access,
            trace,
            session: (id) => this.session(id, access, trace),
            get: (key) => this.records.get(key),
            values: () => this.records.values(),
            output,
            write,
            check,
            grant: (id) => {
              if (access.visible !== 'all') access.visible.add(id);
            },
            readPack: async (id) => {
              check();
              if (!access.packs) fail('CONTEXT_PACK_STORAGE_UNAVAILABLE', trace);
              const rawPack = await access.packs.request({
                method: 'GET',
                path: '/v1/context-pack?pack_id=' + encodeURIComponent(id) + '&format=json',
                headers: {
                  'x-trace-id': trace,
                  'x-tenant-id': this.scope.tenant_id,
                  'x-workspace-id': this.scope.workspace_id,
                  'x-project-id': this.scope.project_id,
                  'x-expected-actor-id': access.identity.actor_id,
                  'x-expected-client-id': access.identity.client_id,
                },
                response_type: 'bounded-json',
                max_response_bytes: MAX_RESPONSE,
                signal: budget.signal,
              });
              check();
              return parseContextPackReadEnvelope(
                rawPack,
                { pack_id: id, format: 'json' },
                this.scope,
                trace,
              ).data;
            },
          }),
        );
      }
      if (request.method === 'GET') {
        if (request.body !== undefined) throw new TypeError();
        if (url.pathname === '/v1/sessions/command-context') {
          if (url.search) throw new TypeError();
          return output(
            parseSessionCommandContextEnvelope(
              envelope(
                {
                  identity: access.identity,
                  expires_at: access.expires_at,
                  permissions: access.permissions,
                },
                trace,
              ),
              this.scope,
              trace,
            ),
          );
        }
        if (!access.permissions.read_sessions) fail('DENIED', trace);
        return output(this.read(url, access, trace));
      }
      if (request.method !== 'POST' || url.search) fail('MOCK_ROUTE_NOT_FOUND', trace);
      if (url.pathname === '/v1/sessions' || url.pathname === '/v1/sessions/start/receipt')
        return this.start(request, access, trace, output, write);
      return this.command(request, access, trace, output, write);
    } catch (error) {
      if (error instanceof ContractError) {
        if (error.envelope.trace_id === trace) throw error;
        fail(error.envelope.code, trace);
      }
      fail('INVALID_INPUT', trace);
    } finally {
      budget.close();
    }
  }

  private start(
    request: Request,
    access: Access,
    trace: string,
    output: (value: unknown) => unknown,
    write: (changes: Change[]) => void,
  ) {
    const lookup = request.path.endsWith('/receipt');
    if (!(lookup ? access.permissions.read_sessions : access.permissions.write_sessions))
      fail('DENIED', trace);
    if (!access.project_readable) fail('PROJECT_NOT_FOUND', trace);
    if (
      request.headers['if-match'] !== undefined ||
      request.headers['if-match-version'] !== undefined
    )
      throw new TypeError();
    const query = lookup
      ? parseSessionStartReceiptQuery(request.body)
      : parseSessionStartReceiptQuery({
          request_key: validateIdempotencyKey(request.headers['idempotency-key']),
          session: request.body,
        });
    const binding = parseSessionStartBinding(query, access.identity, this.scope);
    if (query.session.parent_session_id)
      this.session(query.session.parent_session_id, access, trace);
    const key = JSON.stringify([
      'start',
      access.identity.actor_id,
      access.identity.client_id,
      query.request_key,
    ]);
    const hash = fingerprint(query.session as Record<string, unknown>);
    const previous = this.records.get(key);
    if (previous && (previous.kind !== 'start' || previous.fingerprint !== hash))
      fail('IDEMPOTENCY_KEY_REUSED', trace);
    if (previous?.kind === 'start') {
      const session = this.session(previous.receipt.session_id, access, trace);
      assertSessionStartCurrent(session, previous.receipt, this.scope);
      const result = lookup
        ? envelope(previous.receipt, trace)
        : {
            ...envelope(
              { ...session, start_receipt: previous.receipt },
              trace,
              session.source_refs,
            ),
            etag: buildEtag(session.version),
          };
      return output(parseSessionStartEnvelope(result, binding, trace, lookup));
    }
    if (lookup)
      return output(
        parseSessionStartEnvelope(
          envelope({ status: 'not-observed' }, trace),
          binding,
          trace,
          true,
        ),
      );
    const session: SessionMutationSession = {
      ...this.scope,
      schema_version: 1,
      session_id: createUlid(),
      actor_id: access.identity.actor_id,
      client_id: access.identity.client_id,
      ...(query.session.parent_session_id === undefined
        ? {}
        : { parent_session_id: query.session.parent_session_id as Ulid }),
      status: 'running',
      version: 1,
      started_at: new Date().toISOString(),
      trace_id: trace,
      source_refs: [{ type: 'session', id: access.identity.client_id }],
    };
    const receipt: SessionStartRecorded = {
      status: 'recorded',
      session_id: session.session_id,
      actor_id: session.actor_id,
      client_id: session.client_id,
      started_at: session.started_at,
      session_version: 1,
      ...(session.parent_session_id === undefined
        ? {}
        : { parent_session_id: session.parent_session_id }),
    };
    const result = output(
      parseSessionStartEnvelope(
        {
          ...envelope({ ...session, start_receipt: receipt }, trace, session.source_refs),
          etag: buildEtag(1),
        },
        binding,
        trace,
        false,
      ),
    );
    write([
      { key: 'session:' + session.session_id, value: { kind: 'session', value: session } },
      { key, value: { kind: 'start', fingerprint: hash, receipt } },
    ]);
    if (access.visible !== 'all') access.visible.add(session.session_id);
    return result;
  }

  private command(
    request: Request,
    access: Access,
    trace: string,
    output: (value: unknown) => unknown,
    write: (changes: Change[]) => void,
  ) {
    const match =
      /^\/v1\/sessions\/([^/]+)\/(runs(?:\/([^/]+)\/finish)?|tool-calls(?:\/([^/]+)\/finish)?|end|commands\/receipt)$/.exec(
        request.path,
      );
    if (!match || !isUlid(match[1])) fail('MOCK_ROUTE_NOT_FOUND', trace);
    const id = match[1];
    const action = match[2]!;
    const lookup = action === 'commands/receipt';
    if (!(lookup ? access.permissions.read_sessions : access.permissions.write_sessions))
      fail('DENIED', trace);
    const session = this.session(id, access, trace);
    let query: SessionCommandReceiptQuery;
    if (lookup) query = parseSessionCommandReceiptQuery(request.body);
    else {
      const operation =
        action === 'runs'
          ? 'run.start'
          : action === 'tool-calls'
            ? 'tool.call'
            : action === 'end'
              ? 'end'
              : match[3]
                ? 'run.finish'
                : 'tool.finish';
      const body = object(request.body);
      const request_key = validateIdempotencyKey(request.headers['idempotency-key']);
      if (
        request.headers['if-match'] !== undefined &&
        parseEtag(request.headers['if-match']) !== body.expected_version
      )
        throw new TypeError();
      if (request.headers['if-match-version'] !== undefined) throw new TypeError();
      if ((match[3] && body.run_id !== match[3]) || (match[4] && body.tool_call_id !== match[4]))
        throw new TypeError();
      const command =
        operation === 'run.start' || operation === 'tool.call'
          ? parseSessionActivityCreateCommand(operation, body)
          : parseSessionFinishCommand(operation, body);
      query = parseSessionCommandReceiptQuery({ operation, request_key, command });
    }
    const binding = parseSessionCommandBinding(id, query, access.identity, this.scope);
    const key = JSON.stringify([
      'command',
      id,
      query.operation,
      access.identity.actor_id,
      access.identity.client_id,
      query.request_key,
    ]);
    const hash = fingerprint({ ...query.command, session_id: id });
    const previous = this.records.get(key);
    if (previous && (previous.kind !== 'command' || previous.fingerprint !== hash))
      fail('IDEMPOTENCY_KEY_REUSED', trace);
    if (lookup && !previous)
      return output(
        parseSessionCommandReceiptEnvelope(
          envelope({ status: 'not-observed', session_id: id, operation: query.operation }, trace),
          binding,
          trace,
        ),
      );
    const command = mutation(query, id, this.scope, trace);
    let result: SessionMutationResult;
    if (previous?.kind === 'command') result = readSessionMutationReceipt(previous.result, command);
    else {
      const run =
        'run_id' in command.input ? this.records.get('run:' + command.input.run_id) : undefined;
      const tool =
        'tool_call_id' in command.input
          ? this.records.get('tool:' + command.input.tool_call_id)
          : undefined;
      let sequence = 0;
      for (const row of this.records.values())
        if (row.kind === 'run' && row.value.session_id === id)
          sequence = Math.max(sequence, row.value.sequence);
      result = prepareSessionMutation(command, {
        session,
        last_run_sequence: sequence,
        ...(run?.kind === 'run' ? { run: run.value } : {}),
        ...(tool?.kind === 'tool' ? { tool_call: tool.value } : {}),
      });
      result = readSessionMutationReceipt(result, command);
    }
    if (lookup)
      return output(
        parseSessionCommandReceiptEnvelope(
          envelope(receiptResult(result, query), trace),
          binding,
          trace,
        ),
      );
    const response = commandResult(result, trace);
    const returned = output(
      query.operation === 'run.start' || query.operation === 'tool.call'
        ? parseSessionActivityCreateEnvelope(response, binding, trace)
        : parseSessionFinishEnvelope(response, binding, trace),
    );
    if (!previous) {
      const changes: Change[] = [
        { key: 'session:' + id, value: { kind: 'session', value: result.session } },
        { key, value: { kind: 'command', fingerprint: hash, result } },
      ];
      if ('run' in result)
        changes.push({
          key: 'run:' + result.run.run_id,
          value: { kind: 'run', value: result.run },
        });
      if ('tool_call' in result)
        changes.push({
          key: 'tool:' + result.tool_call.tool_call_id,
          value: { kind: 'tool', value: result.tool_call },
        });
      write(changes);
    }
    return returned;
  }

  private read(url: URL, access: Access, trace: string): unknown {
    const match = /^\/v1\/sessions\/([^/]+)(?:\/(runs|tool-calls)(?:\/([^/]+))?)?$/.exec(
      url.pathname,
    );
    if (!match || !isUlid(match[1])) fail('MOCK_ROUTE_NOT_FOUND', trace);
    const id = match[1];
    const stored = this.session(id, access, trace);
    const session = { session_id: id, status: stored.status, version: stored.version };
    const refs = [{ type: 'session', id }];
    const metadata = {
      ...this.scope,
      session_identity: access.identity,
      session_permissions: { write_sessions: access.permissions.write_sessions },
    };
    if (!match[2]) {
      if (url.search) throw new TypeError();
      return parseSessionStateEnvelope(
        {
          ...envelope({ ...session, ended_at: stored.ended_at ?? null }, trace, refs),
          ...metadata,
        },
        id,
        this.scope,
        trace,
      );
    }
    const detailId = match[3];
    if (detailId) {
      if (!isUlid(detailId) || url.search) throw new TypeError();
      if (match[2] === 'runs') {
        const run = this.records.get('run:' + detailId);
        if (run?.kind !== 'run' || run.value.session_id !== id) fail('RUN_NOT_FOUND', trace);
        return {
          ...envelope(
            parseSessionRunDetail({ session, run: run.value }, id, detailId),
            trace,
            refs,
          ),
          ...metadata,
        };
      }
      const tool = this.records.get('tool:' + detailId);
      if (tool?.kind !== 'tool' || tool.value.session_id !== id) fail('TOOL_CALL_NOT_FOUND', trace);
      const run = this.records.get('run:' + tool.value.run_id);
      if (run?.kind !== 'run' || run.value.session_id !== id) fail('RUN_NOT_FOUND', trace);
      return {
        ...envelope(
          parseSessionToolCallDetail(
            { session, run: run.value, tool_call: tool.value },
            id,
            detailId,
          ),
          trace,
          refs,
        ),
        ...metadata,
      };
    }
    const input: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [name, value] of url.searchParams) {
      if (Object.hasOwn(input, name) || !value) throw new TypeError();
      if (name === 'limit' || name === 'before_sequence') {
        if (!/^[1-9][0-9]*$/.test(value)) throw new TypeError();
        input[name] = Number(value);
      } else input[name] = value;
    }
    if (match[2] === 'runs') {
      const query = parseSessionRunQuery(input);
      const candidates: SessionMutationRun[] = [];
      for (const row of this.records.values())
        if (
          row.kind === 'run' &&
          row.value.session_id === id &&
          row.value.sequence < (query.before_sequence ?? 2147483648)
        )
          candidates.push(row.value);
      candidates.sort((a, b) => b.sequence - a.sequence);
      const runs = candidates.slice(0, query.limit);
      const data = parseSessionRunPage(
        {
          session,
          runs,
          ...(candidates.length > runs.length
            ? { next_before_sequence: runs.at(-1)!.sequence }
            : {}),
        },
        id,
        query,
      );
      return { ...envelope(data, trace, refs), ...metadata };
    }
    const query = parseSessionToolCallQuery(input);
    if (query.run_id) {
      const run = this.records.get('run:' + query.run_id);
      if (run?.kind !== 'run' || run.value.session_id !== id) fail('RUN_NOT_FOUND', trace);
    }
    const candidates: SessionMutationToolCall[] = [];
    for (const row of this.records.values())
      if (
        row.kind === 'tool' &&
        row.value.session_id === id &&
        (query.run_id === undefined || row.value.run_id === query.run_id) &&
        (query.before_id === undefined || row.value.tool_call_id < query.before_id)
      )
        candidates.push(row.value);
    candidates.sort((a, b) =>
      a.tool_call_id < b.tool_call_id ? 1 : a.tool_call_id > b.tool_call_id ? -1 : 0,
    );
    const tool_calls = candidates.slice(0, query.limit);
    const data = parseSessionToolCallPage(
      {
        session,
        tool_calls,
        ...(query.run_id === undefined ? {} : { run_id: query.run_id }),
        ...(candidates.length > tool_calls.length
          ? { next_before_id: tool_calls.at(-1)!.tool_call_id }
          : {}),
      },
      id,
      query,
    );
    return { ...envelope(data, trace, refs), ...metadata };
  }

  private commit(changes: Change[], trace: string, check: () => void) {
    let bytes = this.storedBytes;
    let count = this.records.size;
    const prepared = changes.map(({ key, value }) => ({
      key,
      value: snapshot(value, CONTINUITY_RESPONSE),
    }));
    const size = (key: string, value: Stored) =>
      new TextEncoder().encode(JSON.stringify([key, value])).byteLength;
    for (const { key, value } of prepared) {
      const previous = this.records.get(key);
      bytes += size(key, value) - (previous ? size(key, previous) : 0);
      if (!previous) count++;
    }
    if (count > MAX_RECORDS || bytes > MAX_STORE_BYTES) fail('MOCK_SESSION_CAPACITY', trace);
    check();
    // No asynchronous gap or caller-owned references between preflight and commit.
    for (const { key, value } of prepared) this.records.set(key, value);
    this.storedBytes = bytes;
  }
}
