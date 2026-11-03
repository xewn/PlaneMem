import {
  ContractError,
  isSyncIdentifier,
  parseSyncCommandIdentity,
  syncJsonSnapshot,
  type SyncCommandIdentity,
  type SyncChange,
} from '@planemem/contracts';

export const INBOX_APPLICATION_STATE_BYTES = 1024 * 1024;
export const INBOX_APPLICATION_REDUCTION_BYTES = 64 * 1024 * 1024;
export interface SyncInboxApplication {
  name: string;
  version: string;
}
export interface SyncInboxApplicationQuery {
  expected_identity: SyncCommandIdentity;
  application: SyncInboxApplication;
  timeout_ms: number;
}
export interface SyncInboxApplicationApplyQuery extends SyncInboxApplicationQuery {
  document_sha256: string;
  expected_previous_sha256: string | null;
}
/** Trusted synchronous, side-effect-free application code. The initial projection is JSON null. */
export type SyncInboxApplicationReducer = (projection: unknown, change: SyncChange) => unknown;
export type SyncInboxApplicationHandlers = Record<string, SyncInboxApplicationReducer>;
export interface SyncInboxApplicationState {
  schema_version: 1;
  trace_id: string;
  source_refs: [];
  scope: { tenant_id: string; workspace_id: string; project_id: string };
  expected_identity: SyncCommandIdentity;
  application: SyncInboxApplication;
  recorded: boolean;
  applied_cursor: number;
  page_count: number;
  head_sha256: string | null;
  last_application_trace_id: string | null;
  projection_sha256: string;
  projection: unknown;
  application_scope: 'local-reducer';
  server_application: 'not-verified';
  source_authenticity: 'not-verified';
  acknowledgement_dispatch_state: 'not-sent';
  full_application_history_audit: 'not-performed';
}
export function applicationFailure(code: string, message: string, trace: string) {
  let safeTrace: string;
  try {
    safeTrace = applicationTrace(trace);
  } catch {
    safeTrace = 'trace_inbox_application_invalid';
  }
  return new ContractError(code, message, {
    trace_id: safeTrace,
    retryable: false,
    local_commit_state: 'not-committed',
    acknowledgement_dispatch_state: 'not-sent',
  });
}
export function applicationDigest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError();
  return value;
}
export function applicationTrace(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError();
  return value;
}
function query(value: unknown, apply: boolean) {
  const raw: unknown = JSON.parse(syncJsonSnapshot(value, 16384));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError();
  const row = raw as Record<string, unknown>;
  const fields = [
    'expected_identity',
    'application',
    'timeout_ms',
    ...(apply ? ['document_sha256', 'expected_previous_sha256'] : []),
  ];
  if (
    Object.keys(row).some((key) => !fields.includes(key)) ||
    !row.application ||
    typeof row.application !== 'object' ||
    Array.isArray(row.application)
  )
    throw new TypeError();
  const application = row.application as Record<string, unknown>;
  if (
    Object.keys(application).length !== 2 ||
    Object.keys(application).some((key) => key !== 'name' && key !== 'version') ||
    !isSyncIdentifier(application.name) ||
    !isSyncIdentifier(application.version)
  )
    throw new TypeError();
  const timeout = row.timeout_ms === undefined ? 30_000 : row.timeout_ms;
  if (
    typeof timeout !== 'number' ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 90_000
  )
    throw new TypeError();
  return {
    row,
    value: {
      expected_identity: parseSyncCommandIdentity(row.expected_identity),
      application: { name: application.name, version: application.version },
      timeout_ms: timeout,
    },
  };
}
export function parseInboxApplicationQuery(
  value: unknown,
  trace: string,
): SyncInboxApplicationQuery {
  try {
    applicationTrace(trace);
    return query(value, false).value;
  } catch {
    throw applicationFailure(
      'INBOX_APPLICATION_QUERY_INVALID',
      'Supply a complete original identity, application name/version and optional 1–90000 ms timeout',
      trace,
    );
  }
}
export function parseInboxApplicationApplyQuery(
  value: unknown,
  trace: string,
): SyncInboxApplicationApplyQuery {
  try {
    applicationTrace(trace);
    const parsed = query(value, true);
    return {
      ...parsed.value,
      document_sha256: applicationDigest(parsed.row.document_sha256),
      expected_previous_sha256:
        parsed.row.expected_previous_sha256 === null
          ? null
          : applicationDigest(parsed.row.expected_previous_sha256),
    };
  } catch {
    throw applicationFailure(
      'INBOX_APPLICATION_QUERY_INVALID',
      'Supply the original application, exact saved page digest and expected previous application digest (or null)',
      trace,
    );
  }
}
export function applicationHandlers(value: SyncInboxApplicationHandlers, trace: string) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    const prototype: unknown = Object.getPrototypeOf(value);
    const fields = Object.keys(value);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      fields.length > 512 ||
      Reflect.ownKeys(value).length !== fields.length
    )
      throw new TypeError();
    const handlers = new Map<string, SyncInboxApplicationReducer>();
    for (const key of fields) {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (
        !isSyncIdentifier(key) ||
        !property ||
        !Object.hasOwn(property, 'value') ||
        typeof property.value !== 'function'
      )
        throw new TypeError();
      handlers.set(key, property.value as SyncInboxApplicationReducer);
    }
    return handlers;
  } catch {
    throw applicationFailure(
      'INBOX_APPLICATION_HANDLERS_INVALID',
      'Supply explicit own synchronous reducer functions keyed by supported event type',
      trace,
    );
  }
}
