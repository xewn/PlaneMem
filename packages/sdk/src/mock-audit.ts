import {
  AUDIT_EXPORT_REQUEST_BYTES,
  AUDIT_EXPORT_RESPONSE_BYTES,
  ContractError,
  WORKBENCH_AUDIT_LIMIT,
  WORKBENCH_AUDIT_RESPONSE_BYTES,
  auditExportDocument,
  auditExportDocumentJson,
  compareWorkbenchAuditPositions,
  createUlid,
  encodeWorkbenchAuditCursor,
  isUlid,
  parseAuditExportEnvelope,
  parseAuditExportRequest,
  parseSyncCommandIdentity,
  parseWorkbenchAuditCursor,
  parseWorkbenchAuditEnvelope,
  parseWorkbenchAuditPosition,
  parseWorkbenchAuditQuery,
  parseWorkbenchAuditRecord,
  syncJsonSnapshot,
  type AuditExportEnvelope,
  type AuditExportRequest,
  type SyncCommandIdentity,
  type WorkbenchAuditQuery,
  type WorkbenchAuditRecord,
  type WorkbenchAuditScope,
} from '@planemem/contracts';
import type { WcpRequest, WcpTransport } from './client.js';
import { createRequestBudget } from './request-budget.js';

const seedBytes = 16 * 1024 * 1024;
const releaseBytes = 16 * 1024 * 1024;
const releaseRecordBytes = 16 * 1024;
const configurationTrace = 'trace_mock_audit_configuration';
export interface MockAuditSeed {
  scope: WorkbenchAuditScope;
  /** Complete supplied projections, including explicit unavailable-field states and sizes. */
  records: WorkbenchAuditRecord[];
}
/** Explicit simulated export decisions, never credentials or a real policy evaluation. */
export interface MockAuditExportAccess {
  export_data: boolean;
  export_restricted: boolean;
  policy_allowed: boolean;
}
/** Store-owner development observation; not durable audit or confirmed client delivery. */
export interface MockAuditExportRelease {
  schema_version: 1;
  simulation: true;
  audit_id: string;
  identity: SyncCommandIdentity;
  selection: AuditExportRequest;
  classification: WorkbenchAuditRecord['classification'];
  document_bytes: number;
  details_state: WorkbenchAuditRecord['details_state'];
  source_refs_state: WorkbenchAuditRecord['source_refs_state'];
  trace_id: string;
  occurred_at: string;
  client_delivery_state: 'not-confirmed';
}
/** Explicit simulated decisions; historical authors and request headers never grant permission. */
export interface MockAuditSession {
  identity: SyncCommandIdentity;
  expires_at: string;
  project_readable: boolean;
  read_audit: boolean;
  read_restricted: boolean;
  visible_audit_ids: string[];
  export_access?: MockAuditExportAccess;
}
type Session = MockAuditSession & { visible: Set<string> };
const messages = {
  MOCK_AUDIT_CONFIGURATION_INVALID: 'Supply a bounded audit dataset and explicit simulated session',
  MOCK_ROUTE_NOT_FOUND: 'Mock audit route or operation not found',
  INVALID_INPUT:
    'Supply an exact audit query or reviewed export selection without write conditions',
  UNAUTHENTICATED: 'The simulated audit session has expired',
  DENIED: 'The simulated session does not permit this audit operation',
  NOT_FOUND: 'The selected audit record is not visible in this simulated project',
  AUDIT_EXPORT_BUSY: 'Simulated audit export capacity is occupied',
  AUDIT_EXPORT_CONFLICT: 'Read and review the audit view again before preparing an export',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The simulated export release could not be recorded',
  AUDIT_INTEGRITY_UNAVAILABLE: 'The simulated audit digest could not be calculated',
  WORKBENCH_AUDIT_INVALID: 'The complete simulated audit response is invalid',
  GATEWAY_RESPONSE_INVALID:
    'The complete simulated response exceeds its size or representation limit',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the simulated audit operation',
  GATEWAY_REQUEST_TIMEOUT: 'The simulated audit operation exceeded its local deadline',
  RATE_LIMITED: 'Simulated audit read capacity is occupied',
} as const;
type ErrorCode = keyof typeof messages;
function fail(code: ErrorCode, trace: string, details: Record<string, unknown> = {}): never {
  throw new ContractError(code, messages[code], { trace_id: trace, retryable: false, details });
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
function record(value: unknown, required: string[], optional: string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (
    required.some((key) => !Object.hasOwn(row, key)) ||
    Object.keys(row).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new TypeError();
  return row;
}

/** Export routes use the path; query dispatch inspects only an own operation data property. */
export function isMockAuditRequest(request: WcpRequest): boolean {
  if (typeof request.path === 'string' && /^\/v1\/audit\/export(?:[?#].*)?$/.test(request.path))
    return true;
  return (
    typeof request.path === 'string' &&
    /^\/v1\/workbench\/query(?:[?#].*)?$/.test(request.path) &&
    !!request.body &&
    typeof request.body === 'object' &&
    !Array.isArray(request.body) &&
    Object.getOwnPropertyDescriptor(request.body, 'operation')?.value === 'audit'
  );
}

/** Immutable seed projections with optional in-memory export observations; no PostgreSQL access. */
export class MockAuditStore {
  readonly #id = createUlid();
  readonly #scope: WorkbenchAuditScope;
  readonly #records = new Map<string, WorkbenchAuditRecord>();
  readonly #ordered: WorkbenchAuditRecord[];
  readonly #releases = new Map<string, MockAuditExportRelease>();
  #releaseBytes = 0;
  #activeExports = 0;
  #active = 0;

  constructor(seed: MockAuditSeed) {
    this.#scope = checked('MOCK_AUDIT_CONFIGURATION_INVALID', configurationTrace, () => {
      const input = record(snapshot(seed, seedBytes), ['scope', 'records']);
      const scope = record(input.scope, ['tenant_id', 'workspace_id', 'project_id']);
      const identity = parseSyncCommandIdentity({ ...scope, actor_id: 'mock', client_id: 'mock' });
      if (!Array.isArray(input.records) || input.records.length > 1000) throw new TypeError();
      for (const raw of input.records) {
        const row = record(raw, [
          'audit_id',
          'actor_id',
          'client_id',
          'session_id',
          'action',
          'resource',
          'result',
          'classification',
          'details',
          'details_state',
          'details_bytes',
          'trace_id',
          'source_refs',
          'source_refs_state',
          'source_refs_bytes',
          'occurred_at',
        ]);
        const entry = parseWorkbenchAuditRecord(row);
        if (this.#records.has(entry.audit_id)) throw new TypeError();
        this.#records.set(entry.audit_id, entry);
      }
      return {
        tenant_id: identity.tenant_id,
        workspace_id: identity.workspace_id,
        project_id: identity.project_id,
      };
    });
    this.#ordered = [...this.#records.values()].sort((a, b) =>
      compareWorkbenchAuditPositions(b, a),
    );
  }

  connect(session: MockAuditSession): WcpTransport {
    const saved = checked('MOCK_AUDIT_CONFIGURATION_INVALID', configurationTrace, (): Session => {
      const input = record(
        snapshot(session, 1024 * 1024),
        [
          'identity',
          'expires_at',
          'project_readable',
          'read_audit',
          'read_restricted',
          'visible_audit_ids',
        ],
        ['export_access'],
      );
      const identity = parseSyncCommandIdentity(input.identity);
      for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
        if (identity[field] !== this.#scope[field]) throw new TypeError();
      const expires_at = parseWorkbenchAuditPosition({
        occurred_at: input.expires_at,
        audit_id: this.#id,
      }).occurred_at;
      for (const field of ['project_readable', 'read_audit', 'read_restricted'])
        if (typeof input[field] !== 'boolean') throw new TypeError();
      if (!Array.isArray(input.visible_audit_ids) || input.visible_audit_ids.length > 1000)
        throw new TypeError();
      const visible = new Set<string>();
      for (const id of input.visible_audit_ids) {
        if (typeof id !== 'string' || !this.#records.has(id) || visible.has(id))
          throw new TypeError();
        visible.add(id);
      }
      let access: MockAuditExportAccess | undefined;
      if (input.export_access !== undefined) {
        const row = record(input.export_access, [
          'export_data',
          'export_restricted',
          'policy_allowed',
        ]);
        if (Object.values(row).some((value) => typeof value !== 'boolean')) throw new TypeError();
        access = {
          export_data: row.export_data as boolean,
          export_restricted: row.export_restricted as boolean,
          policy_allowed: row.policy_allowed as boolean,
        };
      }
      return {
        identity,
        expires_at,
        project_readable: input.project_readable as boolean,
        read_audit: input.read_audit as boolean,
        read_restricted: input.read_restricted as boolean,
        visible_audit_ids: [...visible].sort(),
        visible,
        ...(access === undefined ? {} : { export_access: access }),
      };
    });
    return {
      request: async <T = unknown>(request: WcpRequest): Promise<T> =>
        (await this.respond(request, saved)) as T,
    };
  }

  /** Trusted store-owner inspection only; this is not a public WCP audit route. */
  getExportRelease(auditId: string): MockAuditExportRelease | undefined {
    if (!isUlid(auditId)) fail('INVALID_INPUT', configurationTrace);
    const saved = this.#releases.get(auditId);
    return saved === undefined
      ? undefined
      : (snapshot(saved, releaseRecordBytes) as MockAuditExportRelease);
  }

  private async exportView(
    selection: AuditExportRequest,
    session: Session,
    maximum: number,
    trace: string,
    live: () => void,
    released: (id: string) => void,
  ): Promise<AuditExportEnvelope> {
    if (this.#activeExports >= 2) fail('AUDIT_EXPORT_BUSY', trace);
    this.#activeExports++;
    try {
      const select = () => {
        live();
        const access = session.export_access;
        // Even public records require an explicitly configured export capability.
        if (!access || !access.policy_allowed || (!access.export_data && !access.export_restricted))
          fail('DENIED', trace);
        const entry = this.#records.get(selection.audit_id);
        if (
          !entry ||
          !session.visible.has(entry.audit_id) ||
          (entry.classification === 'restricted' && !session.read_restricted)
        )
          fail('NOT_FOUND', trace);
        if (entry.classification === 'restricted' && !access.export_restricted)
          fail('DENIED', trace);
        return entry;
      };
      const entry = select();
      const json = checked('WORKBENCH_AUDIT_INVALID', trace, () =>
        auditExportDocumentJson(auditExportDocument(this.#scope, entry)),
      );
      const documentBytes = new TextEncoder().encode(json);
      let digest: string;
      try {
        live();
        const hash = await globalThis.crypto.subtle.digest('SHA-256', documentBytes);
        if (!(hash instanceof ArrayBuffer) || hash.byteLength !== 32) throw new TypeError();
        digest = Array.from(new Uint8Array(hash), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
      } catch {
        live();
        return fail('AUDIT_INTEGRITY_UNAVAILABLE', trace);
      }
      const current = select();
      if (
        digest !== selection.sha256 ||
        checked('WORKBENCH_AUDIT_INVALID', trace, () =>
          auditExportDocumentJson(auditExportDocument(this.#scope, current)),
        ) !== json
      )
        fail('AUDIT_EXPORT_CONFLICT', trace);
      const auditId = checked('AUDIT_PERSISTENCE_UNAVAILABLE', trace, () => createUlid());
      if (this.#records.has(auditId) || this.#releases.has(auditId))
        fail('AUDIT_PERSISTENCE_UNAVAILABLE', trace);
      const result = checked('GATEWAY_RESPONSE_INVALID', trace, () =>
        parseAuditExportEnvelope(
          snapshot(
            {
              schema_version: 1,
              trace_id: trace,
              source_refs: [
                { type: 'audit', id: selection.audit_id },
                { type: 'audit', id: auditId },
              ],
              data: {
                document: JSON.parse(json),
                document_sha256: digest,
                document_bytes: documentBytes.byteLength,
                release_audit_id: auditId,
                audit_state: 'release-recorded',
                client_delivery_state: 'not-confirmed',
              },
            },
            Math.min(maximum, AUDIT_EXPORT_RESPONSE_BYTES),
          ),
          selection,
          trace,
        ),
      );
      const release: MockAuditExportRelease = {
        schema_version: 1,
        simulation: true,
        audit_id: auditId,
        identity: session.identity,
        selection,
        classification: current.classification,
        document_bytes: documentBytes.byteLength,
        details_state: current.details_state,
        source_refs_state: current.source_refs_state,
        trace_id: trace,
        occurred_at: new Date().toISOString(),
        client_delivery_state: 'not-confirmed',
      };
      const serialized = checked('AUDIT_PERSISTENCE_UNAVAILABLE', trace, () =>
        syncJsonSnapshot(release, releaseRecordBytes),
      );
      const bytes = new TextEncoder().encode(serialized).byteLength;
      if (this.#releases.size >= 1000 || this.#releaseBytes + bytes > releaseBytes)
        fail('AUDIT_PERSISTENCE_UNAVAILABLE', trace);
      const saved = JSON.parse(serialized) as MockAuditExportRelease;
      live();
      // No await after this simulated commit. A later stopped outer wait cannot undo it.
      this.#releases.set(auditId, saved);
      this.#releaseBytes += bytes;
      released(auditId);
      return result;
    } finally {
      // Keep capacity occupied until any pending native digest has actually settled.
      this.#activeExports--;
    }
  }

  private async page(
    query: WorkbenchAuditQuery,
    session: Session,
    trace: string,
    live: () => void,
  ) {
    const { cursor, ...filters } = query;
    const binding = syncJsonSnapshot(
      [
        'mock-audit-list-v1',
        this.#id,
        this.#scope,
        session.identity,
        session.expires_at,
        session.project_readable,
        session.read_audit,
        session.read_restricted,
        session.visible_audit_ids,
        filters.resource ?? null,
        filters.trace_id ?? null,
        filters.action ?? null,
        filters.audit_id ?? null,
        filters.session_id ?? null,
      ],
      1024 * 1024,
    );
    let key: string;
    try {
      live();
      const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(binding),
      );
      if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) throw new TypeError();
      key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      );
    } catch {
      live();
      return fail('AUDIT_INTEGRITY_UNAVAILABLE', trace);
    }
    live();
    const before =
      cursor === undefined
        ? undefined
        : checked('INVALID_INPUT', trace, () => {
            const parsed = parseWorkbenchAuditCursor(cursor);
            if (parsed.key !== key) throw new TypeError();
            return parsed;
          });
    const selected: WorkbenchAuditRecord[] = [];
    for (const entry of this.#ordered) {
      live();
      if (
        !session.visible.has(entry.audit_id) ||
        (entry.classification === 'restricted' && !session.read_restricted) ||
        Object.entries(filters).some(
          ([field, value]) => entry[field as keyof typeof filters] !== value,
        ) ||
        (before !== undefined && compareWorkbenchAuditPositions(entry, before) >= 0)
      )
        continue;
      selected.push(entry);
      if (selected.length > WORKBENCH_AUDIT_LIMIT) break;
    }
    const data = selected.slice(0, WORKBENCH_AUDIT_LIMIT);
    const has_more = selected.length > WORKBENCH_AUDIT_LIMIT;
    const last = data[data.length - 1];
    return {
      schema_version: 1,
      trace_id: trace,
      // Required protocol projection; in this Mock it is not proof of a PostgreSQL read.
      source_refs: [{ type: 'postgres', id: 'wcp_audit_records' }],
      scope: this.#scope,
      data,
      has_more,
      ...(has_more && last ? { next_cursor: encodeWorkbenchAuditCursor(key, last) } : {}),
    };
  }

  private async respond(raw: WcpRequest, session: Session): Promise<unknown> {
    const { method, path, body, response_type, max_response_bytes, signal } = raw;
    const exporting = path === '/v1/audit/export';
    let release: string | undefined;
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
    if (
      !suppliedTrace?.trim() ||
      suppliedTrace.length > 1024 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(suppliedTrace)
    )
      fail('INVALID_INPUT', trace);
    trace = suppliedTrace;
    const budget = checked('INVALID_INPUT', trace, () =>
      createRequestBudget(trace, exporting ? 75_000 : 30_000, signal),
    );
    const live = () => {
      budget.check();
      if (Date.parse(session.expires_at) <= Date.now()) fail('UNAUTHENTICATED', trace);
      if (!session.project_readable || !session.read_audit) fail('DENIED', trace);
    };
    try {
      live();
      if (method !== 'POST' || (!exporting && path !== '/v1/workbench/query'))
        fail('MOCK_ROUTE_NOT_FOUND', trace);
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
        max_response_bytes === undefined
          ? exporting
            ? AUDIT_EXPORT_RESPONSE_BYTES
            : WORKBENCH_AUDIT_RESPONSE_BYTES
          : max_response_bytes;
      if (
        !Number.isSafeInteger(maximum) ||
        maximum < 1 ||
        (response_type !== undefined && !['json', 'bounded-json'].includes(response_type)) ||
        (response_type === 'bounded-json' && max_response_bytes === undefined)
      )
        fail('INVALID_INPUT', trace);
      if (exporting) {
        const selection = checked('INVALID_INPUT', trace, () =>
          parseAuditExportRequest(
            record(snapshot(body, AUDIT_EXPORT_REQUEST_BYTES), ['scope', 'audit_id', 'sha256']),
          ),
        );
        for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
          if (selection.scope[field] !== this.#scope[field]) fail('DENIED', trace);
        return await budget.wait(() =>
          this.exportView(selection, session, maximum, trace, live, (id) => {
            release = id;
          }),
        );
      }
      const query = checked('INVALID_INPUT', trace, () => {
        const input = record(
          snapshot(body, 16 * 1024),
          ['operation'],
          ['resource', 'trace_id', 'action', 'audit_id', 'session_id', 'cursor'],
        );
        if (input.operation !== 'audit') throw new TypeError();
        const { operation: _operation, ...filters } = input;
        return parseWorkbenchAuditQuery(filters);
      });
      if (this.#active >= 2) fail('RATE_LIMITED', trace);
      return await budget.wait(async () => {
        this.#active++;
        try {
          live();
          const page = await this.page(query, session, trace, live);
          live();
          const captured = checked('GATEWAY_RESPONSE_INVALID', trace, () =>
            snapshot(page, Math.min(maximum, WORKBENCH_AUDIT_RESPONSE_BYTES)),
          );
          const result = checked('WORKBENCH_AUDIT_INVALID', trace, () =>
            parseWorkbenchAuditEnvelope(captured, query, this.#scope, trace),
          );
          live();
          return result;
        } finally {
          // Stopping the outer wait cannot release a slot while its cursor hash is still pending.
          this.#active--;
        }
      });
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
          : 'WORKBENCH_AUDIT_INVALID',
        trace,
        exporting
          ? {
              audit_state: release === undefined ? 'unconfirmed' : 'release-recorded',
              ...(release === undefined ? {} : { release_audit_id: release }),
              client_delivery_state: 'not-confirmed',
            }
          : {},
      );
    } finally {
      budget.close();
    }
  }
}
