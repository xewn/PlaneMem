import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildEtag,
  createUlid,
  ENTITY_KINDS,
  EntitySchemaRegistry,
  validateEntity,
  validateEntity as validateRegisteredEntity,
} from '@planemem/contracts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tenantId = createUlid(1_700_000_000_010);
const workspaceId = createUlid(1_700_000_000_011);
const projectId = createUlid(1_700_000_000_012);
const entityId = createUlid(1_700_000_000_013);

function metadata(projectScoped = true) {
  return {
    schema_version: 1,
    id: entityId,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    ...(projectScoped ? { project_id: projectId } : {}),
    version: 1,
    etag: buildEtag(1),
    source_refs: [{ type: 'fixture', id: 'p0-fixture-entity' }],
    classification: 'internal',
    created_at: '2026-10-20T08:00:00.000Z',
    updated_at: '2026-10-20T08:00:00.000Z',
    trace_id: 'trace_entity_01',
  };
}

test('T0.3 publishes a schema file and registry entry for every core entity', () => {
  const registry = new EntitySchemaRegistry();
  assert.deepEqual(registry.listKinds(), [...ENTITY_KINDS]);
  for (const kind of ENTITY_KINDS) {
    assert.ok(
      fs.existsSync(path.join(root, 'packages/contracts/schemas/entities', `${kind}.json`)),
    );
    assert.equal(registry.getSchema(kind).schema_version, 1);
  }
});

test('T0.3 validates a project-scoped entity and rejects missing or extra fields', () => {
  const valid = {
    ...metadata(),
    title: 'Continuity project',
    status: 'active',
    external_id: 'plane-project-01',
  };
  const accepted = validateRegisteredEntity('Project', valid);
  assert.equal(accepted.valid, true);
  assert.equal(validateEntity('Project', valid).valid, true);

  const missing = { ...valid };
  delete (missing as Record<string, unknown>).title;
  const rejected = validateRegisteredEntity('Project', missing);
  assert.equal(rejected.valid, false);
  if (!rejected.valid) {
    assert.equal(rejected.error.code, 'ENTITY_SCHEMA_VALIDATION_FAILED');
    assert.equal(rejected.error.trace_id, 'trace_entity_01');
  }

  const extra = { ...valid, unreviewed_field: true };
  const extraResult = validateRegisteredEntity('Project', extra);
  assert.equal(extraResult.valid, false);
});

test('T0.3 enforces schema versions, scope shape, and classification enum', () => {
  const valid = {
    ...metadata(),
    title: 'Work item',
    status: 'observed',
    external_id: 'plane-issue-01',
  };
  assert.equal(validateRegisteredEntity('WorkItem', valid).valid, true);
  assert.equal(validateRegisteredEntity('WorkItem', { ...valid, schema_version: 2 }).valid, false);
  assert.equal(
    validateRegisteredEntity('WorkItem', { ...valid, classification: 'secret' }).valid,
    false,
  );
  assert.equal(
    validateRegisteredEntity('WorkItem', { ...valid, tenant_id: 'tenant_01' }).valid,
    false,
  );
});
