import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdminPanel,
  ConflictCenter,
  HandoffCenter,
  WorkbenchApi,
  WorkbenchStore,
  renderProjectDashboard,
  type WorkbenchScope,
} from '@planemem/web-console';

const scope: WorkbenchScope = {
  tenant_id: 'tenant-p5',
  workspace_id: 'workspace-p5',
  project_id: 'project-p5',
};

function fakeApi(
  handler: (operation: string, input: Record<string, unknown>) => unknown,
): WorkbenchApi {
  return new WorkbenchApi(async (operation, input) => ({
    schema_version: 1,
    data: handler(operation, input),
    trace_id: `trace-${operation}`,
    source_refs: [{ type: 'fixture', id: operation }],
  }));
}

test('P5-U01/T5.1 renders work-first project data and preserves source references', async () => {
  const api = fakeApi(() => [
    {
      schema_version: 1,
      ...scope,
      project_id: 'project-a',
      name: 'Alpha',
      open_work_items: 2,
      trace_id: 'trace-project',
      source_refs: [{ type: 'plane', id: 'project-a' }],
    },
  ]);
  const store = new WorkbenchStore(api);
  const state = await store.loadProjects(scope);
  assert.equal(state.status, 'ready');
  assert.equal(renderProjectDashboard(state).rows[0]?.open_work_items, 2);
  assert.equal(store.markStale().status, 'stale');
});

test('P5-U01/T5.1 exposes empty, denied and error states without inventing facts', async () => {
  const empty = await new WorkbenchStore(fakeApi(() => [])).loadProjects(scope);
  assert.equal(empty.status, 'empty');
  const denied = await new WorkbenchStore(
    fakeApi(() => {
      throw new Error('DENIED scope');
    }),
  ).loadProjects(scope);
  assert.equal(denied.status, 'denied');
  const error = await new WorkbenchStore(
    fakeApi(() => {
      throw new Error('timeout');
    }),
  ).loadProjects(scope);
  assert.equal(error.status, 'error');
});

test('P5-I01/T5.2 makes resume and conflict operations explicit and traceable', async () => {
  const api = fakeApi((operation) => (operation.includes('conflict') ? { version: 2 } : {}));
  const handoffs = new HandoffCenter(api);
  assert.equal((await handoffs.resume(scope, 'handoff-1', false)).status, 'error');
  assert.equal((await handoffs.claim(scope, 'handoff-1')).data?.status, 'claimed');
  assert.equal((await handoffs.resume(scope, 'handoff-1', true)).data?.status, 'resumed');
  const conflicts = new ConflictCenter(api);
  assert.equal((await conflicts.resolve(scope, 'conflict-1', 'merge', false)).status, 'error');
  const resolved = await conflicts.resolve(scope, 'conflict-1', 'merge', true);
  assert.equal(resolved.data?.resolution, 'merge');
  assert.ok(resolved.trace_id.startsWith('trace-'));
});

test('P5-S01/T5.3 restricts admin health and marks degraded services stale', () => {
  const health = {
    schema_version: 1 as const,
    release: 'release-1',
    services: [{ name: 'gateway', status: 'degraded' as const, version: '0.1.0' }],
    audit_count: 3,
    trace_id: 'trace-admin',
  };
  assert.equal(new AdminPanel('user', scope).view(health).status, 'denied');
  const admin = new AdminPanel('admin', scope).view(health);
  assert.equal(admin.status, 'stale');
  assert.equal(
    new AdminPanel('admin', scope).view({
      ...health,
      services: [{ ...health.services[0]!, status: 'ok' }],
    }).status,
    'ready',
  );
});
