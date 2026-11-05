import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { ContractError } from '@planemem/contracts';
import { readSessionCurrentSnapshot, sessionCurrentProtocol, type SessionCurrentSnapshot,
  type SessionCurrentStore, type SessionCurrentTarget } from './session-current.js';

export const sessionOriginBridgeFormat = 'p02-session-origin-bridge-v1';
const hex = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const ulid = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** An ABP-owned current approval must bind this entire selection, including the actual DB pool
 * and preserved/migrated lineage. These strings are declarations, not an approval by themselves. */
export interface SessionOriginSelection {
  selection_id: string;
  original_source_commit: string;
  current_source_commit: string;
  original_endpoint_ref: string;
  original_configuration_digest: string;
  operation_key: string;
  specification_digest: string;
  dispatch_attempt: number;
  original_record_digest: string;
  original_trace_id: string;
  parent_session_id: string | null;
  database_lineage_ref: string;
  database_lineage_digest: string;
  protocol_bridge_ref: string;
  protocol_bridge_digest: string;
  writer_fence_ref: string;
  writer_fence_digest: string;
  migration_inventory_digest: string;
}
export interface SessionOriginGrant {
  target: SessionCurrentTarget;
  selection: SessionOriginSelection;
  identity_digest: string;
  approval_ref: string;
  approval_digest: string;
  expires_at: string;
}
export interface SessionOriginAuthority {
  /** Re-read current ABP-approved origin/versions/migration and pool binding on EVERY call.
   * Configuration, an old signature or echoing caller metadata is not an allowing implementation. */
  authorize(target: Readonly<SessionCurrentTarget>, signal?: AbortSignal): Promise<SessionOriginGrant>;
}
export interface SessionOriginRow {
  operation_key: string;
  dispatch_attempt: number;
  fingerprint: string;
  record_json: string | null;
}
export interface SessionOriginSnapshot {
  records: SessionOriginRow[];
  migration_inventory_json: string;
  session: SessionCurrentSnapshot | null;
  session_idempotency_key: string | null;
}
export interface SessionOriginStore {
  /** A single readonly, consistent owning-DB transaction; no import, cache or alternate DB. */
  read(target: Readonly<SessionCurrentTarget>, selection: Readonly<SessionOriginSelection>, signal?: AbortSignal): Promise<SessionOriginSnapshot>;
}
export interface SessionOriginObservation {
  format: typeof sessionOriginBridgeFormat;
  selection: SessionOriginSelection;
  selection_digest: string;
  original_records: ReadonlyArray<Readonly<SessionOriginRow>>;
  original_records_digest: string;
  original_record_json: string;
  original_record_digest: string;
  migration_inventory_json: string;
  migration_inventory_digest: string;
  session: SessionCurrentSnapshot;
  session_digest: string;
  target: SessionCurrentTarget;
  identity_digest: string;
  approval_ref: string;
  approval_digest: string;
  approval_expires_at: string;
  expires_at: string;
}

/** Can replace the current store only by explicit gateway composition. Both original proof and
 * current row must be present; no fallback to the unlinked current store on a missing old table. */
export class SessionOriginBridge implements SessionCurrentStore {
  constructor(private readonly store: SessionOriginStore, private readonly authority: SessionOriginAuthority) {}

  async read(target: Readonly<SessionCurrentTarget>, signal?: AbortSignal): Promise<SessionCurrentSnapshot> {
    const observation = await this.observe(target, signal);
    return { ...observation.session, source_expires_at: observation.expires_at,
      source_revalidate: () => this.revalidate(observation, signal) };
  }

  /** Final source check after outer OIDC/OPA/policy awaits. Preserve the original approval window;
   * the returned observation's budget-clipped expiry is not an authorization renewal. */
  async revalidate(observation: SessionOriginObservation, signal?: AbortSignal): Promise<void> {
    const frozen = structuredClone(observation);
    const controller = new AbortController(); const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const started = Date.now(); const elapsed = performance.now();
    const deadline = Date.parse(frozen.expires_at);
    const timer = setTimeout(abort, Math.max(0, Math.min(30_000, deadline - started)));
    const guard = () => {
      if (controller.signal.aborted || !Number.isFinite(deadline) || Date.now() < started || Date.now() >= deadline ||
          performance.now() - elapsed >= Math.min(30_000, deadline - started)) throw unavailable(frozen.target.trace_id);
    };
    try {
      guard();
      const target = Object.freeze({ ...frozen.target });
      const expected = freezeGrant({ target, selection: frozen.selection, identity_digest: frozen.identity_digest,
        approval_ref: frozen.approval_ref, approval_digest: frozen.approval_digest, expires_at: frozen.approval_expires_at }, target);
      const current = freezeGrant(await this.authority.authorize(target, controller.signal), target); guard();
      if (JSON.stringify(stable(current)) !== JSON.stringify(stable(expected))) throw unavailable(target.trace_id);
    } catch { throw unavailable(frozen.target.trace_id); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }

  async observe(input: Readonly<SessionCurrentTarget>, signal?: AbortSignal,
    expected?: Readonly<{ selection_id: string; selection_digest: string }>): Promise<SessionOriginObservation> {
    const started = Date.now(); const elapsed = performance.now();
    const target = Object.freeze(structuredClone(input));
    const selected = expected === undefined ? undefined : Object.freeze({ ...expected });
    let expires = started + 30_000;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let timer = setTimeout(abort, 30_000);
    const guard = () => {
      if (controller.signal.aborted || Date.now() < started || Date.now() >= expires || performance.now() - elapsed >= 30_000 ||
          JSON.stringify(input) !== JSON.stringify(target)) throw unavailable(target.trace_id);
    };
    try {
      validateTarget(target); guard();
      const grant = freezeGrant(await this.authority.authorize(target, controller.signal), target); guard();
      if (selected && (grant.selection.selection_id !== selected.selection_id ||
          sessionOriginSelectionDigest(grant.selection) !== selected.selection_digest)) throw unavailable(target.trace_id);
      expires = Math.min(expires, Date.parse(grant.expires_at)); guard();
      clearTimeout(timer);
      timer = setTimeout(abort, Math.max(0, Math.min(expires - Date.now(), 30_000 - (performance.now() - elapsed))));
      const raw = await this.store.read(target, grant.selection, controller.signal); guard();
      // Copy every record before crossing another asynchronous boundary. Only strings survive.
      const frozen = structuredClone(raw);
      const observed = inspectSessionOrigin(frozen, grant);
      guard();
      // The store promise resolves only AFTER the database transaction is closed.
      const last = freezeGrant(await this.authority.authorize(target, controller.signal), target); guard();
      if (JSON.stringify(stable(grant)) !== JSON.stringify(stable(last))) throw unavailable(target.trace_id);
      return { ...observed, expires_at: new Date(Math.min(expires,
        Date.now() + 30_000 - (performance.now() - elapsed))).toISOString() };
    } catch {
      throw unavailable(target.trace_id);
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
    }
  }
}

/** Interpretation of DB JSONB text. It preserves that exact text; it cannot recover a pre-JSONB
 * HTTP byte stream, authenticate an arbitrary caller, or attest an actual migration by itself. */
export function inspectSessionOrigin(snapshot: SessionOriginSnapshot, grant: SessionOriginGrant): SessionOriginObservation {
  try {
    const fixed = freezeGrant(grant, grant.target);
    const { target, selection } = fixed;
    validateTarget(target);
    if (!snapshot.session || snapshot.session_idempotency_key !== `continuity:${selection.operation_key}` ||
        !Array.isArray(snapshot.records) || snapshot.records.length !== selection.dispatch_attempt ||
        snapshot.records.length > 1024) throw new Error();
    const inventory = migrationInventory(snapshot.migration_inventory_json);
    if (hash(snapshot.migration_inventory_json) !== selection.migration_inventory_digest ||
        !inventory.some(x => x.version === '011_original_operations' && x.checksum === 'sha256:planemem-p02-011') ||
        !inventory.some(x => x.version === '010_session_continuity_persistence' && x.checksum === 'sha256:planemem-p9-010') ||
        !inventory.some(x => x.version === '025_session_resume_origin' && x.checksum === 'sha256:planemem-session-resume-origin-025') ||
        !inventory.some(x => x.version === '044_session_start_receipts' && x.checksum === 'sha256:planemem-session-start-receipts-044')) throw new Error();
    let total = 0;
    const receiptRefs = new Set<string>();
    let originalSession: Record<string, unknown> | undefined;
    const fingerprint = legacyStartFingerprint(target, selection);
    for (const [index, row] of snapshot.records.entries()) {
      if (!exact(row, ['operation_key', 'dispatch_attempt', 'fingerprint', 'record_json']) ||
          row.operation_key !== selection.operation_key || row.dispatch_attempt !== index + 1 ||
          row.fingerprint !== fingerprint || typeof row.record_json !== 'string' ||
          Buffer.byteLength(row.record_json, 'utf8') > 524288) throw new Error();
      total += Buffer.byteLength(row.record_json, 'utf8'); if (total > 2097152) throw new Error();
      const record = JSON.parse(row.record_json);
      if (!exact(record, ['operation_key', 'dispatch_attempt', 'fingerprint', 'proof']) ||
          record.operation_key !== row.operation_key || record.dispatch_attempt !== row.dispatch_attempt ||
          record.fingerprint !== fingerprint) throw new Error();
      const proof = record.proof;
      if (!exact(proof, ['protocol_version', 'operation_key', 'specification_digest', 'scope', 'action', 'actor_id',
        'client_id', 'endpoint_ref', 'configuration_digest', 'dispatch_attempt', 'outcome', 'receipt_ref',
        'revision', 'result', 'source_refs', 'observed_at']) || proof.protocol_version !== 'p02-continuity-v1' ||
        proof.operation_key !== selection.operation_key || proof.specification_digest !== selection.specification_digest ||
        proof.action !== 'session.start' || proof.actor_id !== target.actor_id || proof.client_id !== target.client_id ||
        proof.endpoint_ref !== selection.original_endpoint_ref || proof.configuration_digest !== selection.original_configuration_digest ||
        proof.dispatch_attempt !== row.dispatch_attempt || !exact(proof.scope, ['tenant_id', 'workspace_id', 'project_id']) ||
        proof.scope.tenant_id !== target.tenant_id || proof.scope.workspace_id !== target.workspace_id ||
        proof.scope.project_id !== target.project_id || !utc(proof.observed_at) ||
        typeof proof.receipt_ref !== 'string' || !/^planemem-operation:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(proof.receipt_ref) ||
        proof.receipt_ref === 'planemem-operation:00000000-0000-0000-0000-000000000000') throw new Error();
      if (receiptRefs.has(proof.receipt_ref)) throw new Error();
      receiptRefs.add(proof.receipt_ref);
      if (index + 1 < selection.dispatch_attempt) {
        if (proof.outcome !== 'ConfirmedNoEffect' || proof.revision !== null || proof.result !== null ||
            !Array.isArray(proof.source_refs) || proof.source_refs.length !== 0) throw new Error();
        continue;
      }
      if (hash(row.record_json) !== selection.original_record_digest || proof.outcome !== 'ConfirmedEffect' || proof.revision !== 1 ||
          !exact(proof.result, ['schema_version', 'trace_id', 'source_refs', 'data']) || proof.result.schema_version !== 1 ||
          proof.result.trace_id !== selection.original_trace_id) throw new Error();
      originalReferences(proof.source_refs, target.client_id); originalReferences(proof.result.source_refs, target.client_id);
      const session = proof.result.data;
      const fields = ['schema_version', 'tenant_id', 'workspace_id', 'project_id', 'session_id', 'client_id', 'actor_id',
        'status', 'version', 'started_at', 'trace_id', 'source_refs'];
      if (selection.parent_session_id !== null) fields.push('parent_session_id');
      if (!exact(session, fields) || session.schema_version !== 1 || session.version !== 1 || session.status !== 'running' ||
          !sameOwner(session, target) || session.trace_id !== selection.original_trace_id || !utc(session.started_at) ||
          Date.parse(session.started_at) > Date.parse(proof.observed_at) ||
          (session.parent_session_id ?? null) !== selection.parent_session_id) throw new Error();
      originalReferences(session.source_refs, target.client_id); originalSession = session;
    }
    const current = readSessionCurrentSnapshot(snapshot.session, target);
    if (!originalSession || current.started_at !== originalSession.started_at ||
        (current.parent_session_id ?? null) !== selection.parent_session_id || current.resume_origin !== undefined) throw new Error();
    // No implicit enrichment of an old start into a main resume operation is permitted by v1.
    const records = snapshot.records.map(row => Object.freeze({ ...row }));
    const record = records.at(-1)!;
    return {
      format: sessionOriginBridgeFormat, selection: structuredClone(selection), selection_digest: sessionOriginSelectionDigest(selection),
      original_records: Object.freeze(records), original_records_digest: hash(JSON.stringify(records)),
      original_record_json: record.record_json!, original_record_digest: hash(record.record_json!),
      migration_inventory_json: snapshot.migration_inventory_json, migration_inventory_digest: selection.migration_inventory_digest,
      session: { ...snapshot.session }, session_digest: hash(snapshot.session.session_json), target: { ...target },
      identity_digest: fixed.identity_digest, approval_ref: fixed.approval_ref, approval_digest: fixed.approval_digest,
      approval_expires_at: fixed.expires_at, expires_at: fixed.expires_at,
    };
  } catch { throw unavailable(grant?.target?.trace_id ?? 'session-origin-unavailable'); }
}

export function legacyStartFingerprint(target: SessionCurrentTarget, selection: SessionOriginSelection): string {
  return hash(JSON.stringify(stable({ protocol_version: 'p02-continuity-v1', operation_key: selection.operation_key,
    specification_digest: selection.specification_digest, endpoint_ref: selection.original_endpoint_ref,
    configuration_digest: selection.original_configuration_digest, action: 'session.start', expected_revision: null,
    payload: selection.parent_session_id === null ? {} : { parent_session_id: selection.parent_session_id },
    scope: [target.tenant_id, target.workspace_id, target.project_id], actor_id: target.actor_id, client_id: target.client_id })));
}
/** Versioned selection digest: recursively ordinal-sorted keys, compact JSON, SHA-256 of UTF-8. */
export function sessionOriginSelectionDigest(selection: SessionOriginSelection): string {
  return hash(JSON.stringify(stable(selection)));
}
function freezeGrant(value: SessionOriginGrant, target: Readonly<SessionCurrentTarget>): SessionOriginGrant {
  if (!exact(value, ['target', 'selection', 'identity_digest', 'approval_ref', 'approval_digest', 'expires_at']) ||
      !exact(value.target, Object.keys(target)) || Object.entries(target).some(([key, item]) => value.target[key as keyof SessionCurrentTarget] !== item) ||
      !hex.test(value.identity_digest) || !hex.test(value.approval_digest) || !text(value.approval_ref, 512) || !utc(value.expires_at)) throw new Error();
  const s = value.selection;
  if (!exact(s, ['selection_id', 'original_source_commit', 'current_source_commit', 'original_endpoint_ref',
    'original_configuration_digest', 'operation_key', 'specification_digest', 'dispatch_attempt', 'original_record_digest',
    'original_trace_id', 'parent_session_id', 'database_lineage_ref', 'database_lineage_digest',
    'protocol_bridge_ref', 'protocol_bridge_digest', 'writer_fence_ref', 'writer_fence_digest', 'migration_inventory_digest']) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s.selection_id) ||
      s.selection_id === '00000000-0000-0000-0000-000000000000' || !commit.test(s.original_source_commit) || !commit.test(s.current_source_commit) ||
      !text(s.original_endpoint_ref, 256) || !hex.test(s.original_configuration_digest) || !/^p02:v1:[a-f0-9]{64}$/.test(s.operation_key) ||
      !hex.test(s.specification_digest) || !Number.isSafeInteger(s.dispatch_attempt) || s.dispatch_attempt < 1 || s.dispatch_attempt > 1024 ||
      !hex.test(s.original_record_digest) || !text(s.original_trace_id, 256) ||
      (s.parent_session_id !== null && (!ulid.test(s.parent_session_id) || s.parent_session_id === target.session_id)) ||
      !text(s.database_lineage_ref, 512) || !hex.test(s.database_lineage_digest) || !text(s.protocol_bridge_ref, 512) ||
      !hex.test(s.protocol_bridge_digest) || !text(s.writer_fence_ref, 512) || !hex.test(s.writer_fence_digest) ||
      !hex.test(s.migration_inventory_digest)) throw new Error();
  return Object.freeze({ ...value, target: Object.freeze({ ...value.target }), selection: Object.freeze({ ...s }) });
}
function validateTarget(value: Readonly<SessionCurrentTarget>): void {
  if (!exact(value, ['protocol_version', 'endpoint_ref', 'configuration_digest', 'tenant_id', 'workspace_id', 'project_id',
    'actor_id', 'client_id', 'session_id', 'challenge', 'trace_id']) || value.protocol_version !== sessionCurrentProtocol ||
      !text(value.endpoint_ref, 512) || !hex.test(value.configuration_digest) || !hex.test(value.challenge) ||
      ![value.tenant_id, value.workspace_id, value.project_id, value.session_id].every(x => ulid.test(x)) ||
      ![value.actor_id, value.client_id, value.trace_id].every(x => text(x, 512))) throw new Error();
}
function migrationInventory(raw: string): Array<{ version: string; checksum: string }> {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 262144) throw new Error();
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length === 0 || value.length > 512) throw new Error();
  let previous = '';
  for (const row of value) {
    if (!exact(row, ['version', 'checksum']) || !text(row.version, 256) || !text(row.checksum, 512) ||
        !/^[A-Za-z0-9_.-]+$/.test(row.version) || row.version <= previous) throw new Error();
    previous = row.version;
  }
  return value;
}
function originalReferences(value: unknown, client: string): void {
  if (!Array.isArray(value) || value.length !== 1 || !exact(value[0], ['type', 'id']) ||
      value[0].type !== 'session' || value[0].id !== client) throw new Error();
}
function sameOwner(value: Record<string, unknown>, target: SessionCurrentTarget): boolean {
  return ['tenant_id', 'workspace_id', 'project_id', 'actor_id', 'client_id', 'session_id']
    .every(key => value[key] === target[key as keyof SessionCurrentTarget]);
}
function exact(value: unknown, keys: string[]): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key));
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function utc(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, stable(item)]));
  return value;
}
function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function unavailable(trace_id: string): ContractError {
  return new ContractError('OPERATION_UNAVAILABLE', 'Original session bridge is unavailable', { trace_id, retryable: false });
}
