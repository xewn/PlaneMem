import {
  ContractError,
  WORKBENCH_ADMIN_RESPONSE_BYTES,
  parseSyncCommandIdentity,
  parseWorkbenchAdminEnvelope,
  syncJsonSnapshot,
  workbenchAdminSources,
  type SyncCommandIdentity,
  type WorkbenchAdminScope,
  type WorkbenchAdminSnapshot,
} from '@planemem/contracts';
import type { WcpRequest, WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

const configurationTrace = 'trace_mock_admin_configuration';
const permissionFields = [
  'authenticated_client',
  'admin_role',
  'read_admin',
  'project_readable',
  'read_audit',
  'read_context',
  'read_restricted',
] as const;

export interface MockAdminSeed {
  scope: WorkbenchAdminScope;
  /** One or two explicit visibility scenarios, with all three counts available in each. */
  snapshots: Array<{ read_restricted: boolean; data: WorkbenchAdminSnapshot }>;
}

/** Explicit simulation inputs. Neither headers nor an admin role grant missing capabilities. */
export interface MockAdminSession {
  identity: SyncCommandIdentity;
  expires_at: string;
  authenticated_client: boolean;
  admin_role: boolean;
  read_admin: boolean;
  project_readable: boolean;
  read_audit: boolean;
  read_context: boolean;
  read_restricted: boolean;
}

const messages = {
  MOCK_ADMIN_CONFIGURATION_INVALID:
    'Supply complete bounded administration scenarios and a matching simulated session',
  MOCK_ROUTE_NOT_FOUND: 'Mock administration route or operation not found',
  INVALID_INPUT: 'Supply only the administration operation and bounded JSON read options',
  UNAUTHENTICATED: 'The simulated client is unauthenticated or its session has expired',
  DENIED: 'The simulated identity or administration permissions do not allow this read',
  NOT_FOUND: 'The project is not available in the simulated readable scope',
  WORKBENCH_ADMIN_INVALID: 'The complete simulated administration snapshot is invalid',
  GATEWAY_RESPONSE_INVALID: 'The complete simulated response exceeds its representation limit',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the simulated administration snapshot',
  GATEWAY_REQUEST_TIMEOUT: 'The simulated administration read exceeded its local deadline',
} as const;
type ErrorCode = keyof typeof messages;

function fail(code: ErrorCode, trace: string): never {
  throw new ContractError(code, messages[code], { trace_id: trace, retryable: false });
}
function checked<T>(code: ErrorCode, trace: string, read: () => T): T {
  try {
    return read();
  } catch {
    return fail(code, trace);
  }
}
function snapshot(value: unknown, maximum: number): unknown {
  return JSON.parse(syncJsonSnapshot(value, maximum));
}
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError();
  return row;
}

/** Inspect only an own operation data property; accessors cannot dispatch an admin read. */
export function isMockAdminRequest(request: WcpRequest): boolean {
  return (
    typeof request.path === 'string' &&
    /^\/v1\/workbench\/query(?:[?#].*)?$/.test(request.path) &&
    !!request.body &&
    typeof request.body === 'object' &&
    !Array.isArray(request.body) &&
    Object.getOwnPropertyDescriptor(request.body, 'operation')?.value === 'admin'
  );
}

/** Fixed scenario projections, never live health checks or observations of other Mock stores. */
export class MockAdminStore {
  readonly #scope: WorkbenchAdminScope;
  readonly #snapshots: Map<boolean, WorkbenchAdminSnapshot>;

  constructor(seed: MockAdminSeed) {
    const saved = checked('MOCK_ADMIN_CONFIGURATION_INVALID', configurationTrace, () => {
      const input = record(snapshot(seed, 64 * 1024), ['scope', 'snapshots']);
      const rawScope = record(input.scope, ['tenant_id', 'workspace_id', 'project_id']);
      const identity = parseSyncCommandIdentity({
        ...rawScope,
        actor_id: 'mock',
        client_id: 'mock',
      });
      const scope = {
        tenant_id: identity.tenant_id,
        workspace_id: identity.workspace_id,
        project_id: identity.project_id,
      };
      if (
        !Array.isArray(input.snapshots) ||
        input.snapshots.length < 1 ||
        input.snapshots.length > 2
      )
        throw new TypeError();
      const snapshots = new Map<boolean, WorkbenchAdminSnapshot>();
      for (const value of input.snapshots) {
        const row = record(value, ['read_restricted', 'data']);
        if (typeof row.read_restricted !== 'boolean' || snapshots.has(row.read_restricted))
          throw new TypeError();
        const data = record(row.data, [
          'read_at',
          'gateway_version',
          'database',
          'counts',
          'checks',
        ]);
        // The full parser below rejects malformed counts and any unavailable seed count.
        const source_refs = workbenchAdminSources(data.counts as WorkbenchAdminSnapshot['counts']);
        const envelope = snapshot(
          {
            schema_version: 1,
            trace_id: configurationTrace,
            scope,
            source_refs,
            data,
          },
          WORKBENCH_ADMIN_RESPONSE_BYTES,
        );
        const parsed = parseWorkbenchAdminEnvelope(envelope, scope, configurationTrace, {
          audit: true,
          context: true,
        });
        snapshots.set(row.read_restricted, parsed.data);
      }
      return { scope, snapshots };
    });
    this.#scope = saved.scope;
    this.#snapshots = saved.snapshots;
  }

  connect(session: MockAdminSession): WcpTransport {
    const saved = checked(
      'MOCK_ADMIN_CONFIGURATION_INVALID',
      configurationTrace,
      (): MockAdminSession => {
        const input = record(snapshot(session, 16 * 1024), [
          'identity',
          'expires_at',
          ...permissionFields,
        ]);
        const identity = parseSyncCommandIdentity(input.identity);
        for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
          if (identity[field] !== this.#scope[field]) throw new TypeError();
        const expires_at = input.expires_at;
        if (
          typeof expires_at !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expires_at) ||
          expires_at.startsWith('0000') ||
          new Date(expires_at).toISOString() !== expires_at
        )
          throw new TypeError();
        for (const key of permissionFields)
          if (typeof input[key] !== 'boolean') throw new TypeError();
        if (!this.#snapshots.has(input.read_restricted as boolean)) throw new TypeError();
        return {
          identity,
          expires_at,
          authenticated_client: input.authenticated_client as boolean,
          admin_role: input.admin_role as boolean,
          read_admin: input.read_admin as boolean,
          project_readable: input.project_readable as boolean,
          read_audit: input.read_audit as boolean,
          read_context: input.read_context as boolean,
          read_restricted: input.read_restricted as boolean,
        };
      },
    );
    return {
      request: async <T = unknown>(request: WcpRequest): Promise<T> =>
        this.respond(request, saved) as T,
    };
  }

  private respond(raw: WcpRequest, session: MockAdminSession): unknown {
    const { method, path, body, response_type, max_response_bytes, signal } = raw;
    let trace = 'trace_unknown';
    const headers = checked('INVALID_INPUT', trace, () => {
      const input = snapshot(raw.headers, 16 * 1024);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError();
      const result = new Map<string, string>();
      for (const [key, value] of Object.entries(input)) {
        if (
          typeof value !== 'string' ||
          result.has(key.toLowerCase()) ||
          /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
        )
          throw new TypeError();
        result.set(key.toLowerCase(), value);
      }
      return result;
    });
    const suppliedTrace = headers.get('x-trace-id') ?? headers.get('traceparent');
    if (!suppliedTrace?.trim() || suppliedTrace.length > 512) fail('INVALID_INPUT', trace);
    trace = suppliedTrace;
    const budget = checked('INVALID_INPUT', trace, () =>
      createRequestBudget(trace, 30_000, signal),
    );
    const live = () => {
      budget.check();
      if (!session.authenticated_client || Date.parse(session.expires_at) <= Date.now())
        fail('UNAUTHENTICATED', trace);
      if (!session.admin_role || !session.read_admin) fail('DENIED', trace);
      if (!session.project_readable) fail('NOT_FOUND', trace);
    };
    try {
      live();
      if (method !== 'POST' || path !== '/v1/workbench/query') fail('MOCK_ROUTE_NOT_FOUND', trace);
      for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
        if (headers.get('x-' + field.replaceAll('_', '-')) !== session.identity[field])
          fail('DENIED', trace);
      for (const [header, field] of [
        ['x-expected-actor-id', 'actor_id'],
        ['x-expected-client-id', 'client_id'],
      ] as const)
        if (headers.has(header) && headers.get(header) !== session.identity[field])
          fail('DENIED', trace);
      if (
        [
          'idempotency-key',
          'if-match',
          'if-match-version',
          'x-expected-version',
          'if-none-match',
          'if-modified-since',
          'if-unmodified-since',
          'range',
          'if-range',
          'content-encoding',
          'transfer-encoding',
          'content-length',
        ].some((key) => headers.has(key))
      )
        fail('INVALID_INPUT', trace);
      const maximum =
        max_response_bytes === undefined ? WORKBENCH_ADMIN_RESPONSE_BYTES : max_response_bytes;
      if (
        !Number.isSafeInteger(maximum) ||
        maximum < 1 ||
        (response_type !== undefined && !['json', 'bounded-json'].includes(response_type)) ||
        (response_type === 'bounded-json' && max_response_bytes === undefined)
      )
        fail('INVALID_INPUT', trace);
      checked('INVALID_INPUT', trace, () => {
        const input = record(snapshot(body, 4 * 1024), ['operation']);
        if (input.operation !== 'admin') throw new TypeError();
      });
      const original = this.#snapshots.get(session.read_restricted);
      if (!original) fail('WORKBENCH_ADMIN_INVALID', trace);
      const denied = { state: 'not-authorized', value: null } as const;
      const counts: WorkbenchAdminSnapshot['counts'] = {
        audit_records: session.read_audit ? original.counts.audit_records : denied,
        running_sessions: session.read_context ? original.counts.running_sessions : denied,
        open_conflicts: session.read_context ? original.counts.open_conflicts : denied,
      };
      // Required protocol source/read-succeeded literals describe only this simulated projection.
      const captured = checked('GATEWAY_RESPONSE_INVALID', trace, () =>
        snapshot(
          {
            schema_version: 1,
            trace_id: trace,
            scope: this.#scope,
            source_refs: workbenchAdminSources(counts),
            data: { ...original, counts },
          },
          Math.min(maximum, WORKBENCH_ADMIN_RESPONSE_BYTES),
        ),
      );
      const result = checked('WORKBENCH_ADMIN_INVALID', trace, () =>
        parseWorkbenchAdminEnvelope(captured, this.#scope, trace, {
          audit: session.read_audit,
          context: session.read_context,
        }),
      );
      live();
      return result;
    } catch (error) {
      let finalError = error;
      try {
        live();
      } catch (stopped) {
        finalError = stopped;
      }
      const envelope = finalError instanceof ContractError ? finalError.envelope : undefined;
      return fail(
        envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
          ? (envelope.code as ErrorCode)
          : 'WORKBENCH_ADMIN_INVALID',
        trace,
      );
    } finally {
      budget.close();
    }
  }
}
