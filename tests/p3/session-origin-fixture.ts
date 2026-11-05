import { createHash, randomUUID } from 'node:crypto';
import { legacyStartFingerprint, type SessionOriginGrant, type SessionOriginSnapshot,
  type SessionOriginSelection } from '../../apps/api-gateway/src/session-origin-bridge.js';
import { sessionCurrentProtocol, type SessionCurrentTarget } from '../../apps/api-gateway/src/session-current.js';

// Synthetic old OperationRecord/approval, not a real migration or production ABP decision.
export const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
export function originFixture(attempts = 1) {
  const target: SessionCurrentTarget = {
    protocol_version: sessionCurrentProtocol, endpoint_ref: 'origin-current-fixture', configuration_digest: 'a'.repeat(64),
    tenant_id: '01HF7YAT000000000000000001', workspace_id: '01HF7YAT000000000000000002',
    project_id: '01HF7YAT000000000000000003', session_id: '01HF7YAT000000000000000004',
    actor_id: 'origin-fixture-actor', client_id: 'origin-fixture-client', challenge: 'b'.repeat(64), trace_id: 'origin-current-trace',
  };
  const selection: SessionOriginSelection = {
    selection_id: randomUUID(), original_source_commit: '1'.repeat(40), current_source_commit: '2'.repeat(40),
    original_endpoint_ref: 'origin-old-fixture', original_configuration_digest: 'c'.repeat(64), operation_key: 'p02:v1:' + 'd'.repeat(64),
    specification_digest: 'e'.repeat(64), dispatch_attempt: attempts, original_record_digest: 'f'.repeat(64),
    original_trace_id: 'origin-start-trace', parent_session_id: null, database_lineage_ref: 'fixture:database-lineage',
    database_lineage_digest: '3'.repeat(64), protocol_bridge_ref: 'fixture:protocol-bridge', protocol_bridge_digest: '4'.repeat(64),
    writer_fence_ref: 'fixture:old-writer-fence', writer_fence_digest: '8'.repeat(64),
    migration_inventory_digest: '5'.repeat(64),
  };
  const original = {
    schema_version: 1, tenant_id: target.tenant_id, workspace_id: target.workspace_id, project_id: target.project_id,
    session_id: target.session_id, actor_id: target.actor_id, client_id: target.client_id, status: 'running', version: 1,
    started_at: '2026-11-05T00:00:00.000Z', trace_id: selection.original_trace_id,
    source_refs: [{ type: 'session', id: target.client_id }],
  };
  const fingerprint = legacyStartFingerprint(target, selection);
  const records = Array.from({ length: attempts }, (_, index) => {
    const effect = index + 1 === attempts;
    const proof = {
      protocol_version: 'p02-continuity-v1', operation_key: selection.operation_key, specification_digest: selection.specification_digest,
      scope: { tenant_id: target.tenant_id, workspace_id: target.workspace_id, project_id: target.project_id },
      action: 'session.start', actor_id: target.actor_id, client_id: target.client_id,
      endpoint_ref: selection.original_endpoint_ref, configuration_digest: selection.original_configuration_digest,
      dispatch_attempt: index + 1, outcome: effect ? 'ConfirmedEffect' : 'ConfirmedNoEffect',
      receipt_ref: 'planemem-operation:' + randomUUID(), revision: effect ? 1 : null,
      result: effect ? { schema_version: 1, trace_id: selection.original_trace_id, source_refs: original.source_refs, data: original } : null,
      source_refs: effect ? original.source_refs : [], observed_at: '2026-11-05T00:00:01.000Z',
    };
    const record = { operation_key: selection.operation_key, dispatch_attempt: index + 1, fingerprint, proof };
    return { operation_key: selection.operation_key, dispatch_attempt: index + 1, fingerprint, record_json: JSON.stringify(record) };
  });
  const inventory = JSON.stringify([
    { version: '010_session_continuity_persistence', checksum: 'sha256:planemem-p9-010' },
    { version: '011_handoff_claim_actor', checksum: 'fixture:main-011' },
    { version: '011_original_operations', checksum: 'sha256:planemem-p02-011' },
    { version: '025_session_resume_origin', checksum: 'sha256:planemem-session-resume-origin-025' },
    { version: '044_session_start_receipts', checksum: 'sha256:planemem-session-start-receipts-044' },
  ]);
  selection.migration_inventory_digest = hash(inventory); selection.original_record_digest = hash(records.at(-1)!.record_json);
  const snapshot: SessionOriginSnapshot = { records, migration_inventory_json: inventory,
    session: { session_json: JSON.stringify({ ...original, version: 3, status: 'ended', ended_at: '2026-11-05T00:01:00.000Z' }),
      observed_at: new Date().toISOString() }, session_idempotency_key: 'continuity:' + selection.operation_key };
  const grant: SessionOriginGrant = { target, selection, identity_digest: '6'.repeat(64), approval_ref: 'fixture:abp-approval',
    approval_digest: '7'.repeat(64), expires_at: new Date(Date.now() + 60_000).toISOString() };
  return { target, selection, original, snapshot, grant };
}
