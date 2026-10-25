import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ContractError,
  IdempotencyLedger,
  assertUtcTimestamp,
  assertUlid,
  buildEtag,
  createUlid,
  normalizePageRequest,
  parseEtag,
  serializeError,
  validateCommonMetadata,
  validateErrorEnvelope,
  validatePageResponse,
  validateRequestContext,
  checkVersionPrecondition,
} from '@planemem/contracts';

const tenantId = createUlid(1_700_000_000_000);
const workspaceId = createUlid(1_700_000_000_001);
const projectId = createUlid(1_700_000_000_002);
const itemId = createUlid(1_700_000_000_003);

test('T0.2 generates and validates canonical ULIDs and UTC timestamps', () => {
  assertUlid(tenantId);
  assert.match(tenantId, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.throws(() => assertUlid('tenant_01'), /ULID/i);
  assertUtcTimestamp('2026-10-20T08:00:00.000Z');
  assert.throws(() => assertUtcTimestamp('2026-10-20T08:00:00+08:00'), /UTC/i);
  assert.throws(() => assertUtcTimestamp('2026-10-20T08:00:00'), /UTC/i);
});

test('T0.2 validates shared metadata and request scope', () => {
  const metadata = validateCommonMetadata({
    id: itemId,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    project_id: projectId,
    version: 1,
    etag: buildEtag(1),
    source_refs: [{ type: 'plane', id: 'issue-1' }],
    classification: 'internal',
    created_at: '2026-10-20T08:00:00.000Z',
    updated_at: '2026-10-20T08:00:00.000Z',
    trace_id: 'trace_01',
  });
  assert.equal(metadata.version, 1);
  assert.equal(
    validateRequestContext({
      trace_id: 'trace_01',
      tenant_id: tenantId,
      workspace_id: workspaceId,
      project_id: projectId,
      idempotency_key: 'idem_01',
    }).tenant_id,
    tenantId,
  );
  assert.throws(
    () =>
      validateCommonMetadata({
        ...metadata,
        classification: 'secret',
      } as never),
    /classification/i,
  );
  assert.throws(
    () =>
      validateRequestContext({
        trace_id: '',
        tenant_id: tenantId,
        workspace_id: workspaceId,
      }),
    /trace/i,
  );
});

test('T0.2 serializes diagnostic error envelopes with trace IDs', () => {
  const error = new ContractError('WORK_ITEM_VERSION_CONFLICT', '版本冲突', {
    expected_version: 3,
    current_version: 4,
    trace_id: 'trace_02',
    retryable: false,
  });
  const envelope = JSON.parse(serializeError(error));
  assert.equal(validateErrorEnvelope(envelope).code, 'WORK_ITEM_VERSION_CONFLICT');
  assert.equal(envelope.trace_id, 'trace_02');
  assert.equal(envelope.retryable, false);
});

test('T0.2 enforces pagination bounds and response invariants', () => {
  assert.deepEqual(normalizePageRequest({}), { limit: 50 });
  assert.deepEqual(normalizePageRequest({ limit: 100, cursor: 'cursor_01' }), {
    limit: 100,
    cursor: 'cursor_01',
  });
  assert.throws(() => normalizePageRequest({ limit: 0 }), /limit/i);
  assert.throws(() => normalizePageRequest({ limit: 101 }), /limit/i);
  assert.equal(
    validatePageResponse({ items: [itemId], has_more: true, next_cursor: 'cursor_02' }).has_more,
    true,
  );
  assert.throws(() => validatePageResponse({ items: [], has_more: true } as never), /next_cursor/i);
});

test('T0.2 prevents duplicate side effects for idempotent retries', () => {
  const ledger = new IdempotencyLedger();
  const first = ledger.claim('idem_01', 'hash_a');
  assert.equal(first.kind, 'new');
  ledger.complete('idem_01', { status: 201, body: { id: itemId } });
  const replay = ledger.claim('idem_01', 'hash_a');
  assert.deepEqual(replay, {
    kind: 'replay',
    response: { status: 201, body: { id: itemId } },
  });
  assert.deepEqual(ledger.claim('idem_01', 'hash_b'), { kind: 'conflict' });
  assert.throws(() => ledger.claim('', 'hash_c'), /Idempotency-Key/i);
});

test('T0.2 checks expected version and ETag preconditions', () => {
  assert.equal(parseEtag(buildEtag(8)), 8);
  assert.equal(checkVersionPrecondition(8, { expected_version: 8 }).ok, true);
  assert.equal(checkVersionPrecondition(8, { if_match: buildEtag(8) }).ok, true);
  const conflict = checkVersionPrecondition(9, {
    expected_version: 8,
    if_match: buildEtag(8),
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error?.code, 'VERSION_CONFLICT');
  assert.equal(conflict.error?.details.current_version, 9);
  assert.throws(() => parseEtag('bad-etag'), /ETag/i);
});
