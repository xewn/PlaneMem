import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { OidcTokenVerifier, WorkbenchRepository } from '@planemem/api-gateway';

type QueryCall = { text: string; params: unknown[] };

function fakeDb(rows: unknown[]) {
  const calls: QueryCall[] = [];
  return {
    calls,
    db: {
      async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
        calls.push({ text, params });
        return rows as T[];
      },
    },
  };
}

const scope = {
  tenant_id: 'tenant-1',
  workspace_id: 'workspace-1',
  project_id: 'project-1',
};

test('workbench repository fences every query by tenant, workspace and project', async () => {
  const fixture = fakeDb([{ id: 'work-1', title: 'Sync context', status: 'in_progress' }]);
  const repository = new WorkbenchRepository(fixture.db);

  const result = await repository.listWorkItems(scope, 'trace-work-items');

  assert.equal(result.data[0]?.id, 'work-1');
  assert.equal(result.trace_id, 'trace-work-items');
  assert.deepEqual(result.source_refs, [{ type: 'postgres', id: 'wcp_work_items' }]);
  assert.deepEqual(fixture.calls[0]?.params, [
    scope.tenant_id,
    scope.workspace_id,
    scope.project_id,
  ]);
  assert.match(fixture.calls[0]?.text ?? '', /tenant_id\s*=\s*\$1/);
  assert.match(fixture.calls[0]?.text ?? '', /workspace_id\s*=\s*\$2/);
  assert.match(fixture.calls[0]?.text ?? '', /project_id\s*=\s*\$3/);
});

test('workbench repository returns an explicit unavailable error without a database', async () => {
  const repository = new WorkbenchRepository(undefined);

  await assert.rejects(
    () => repository.listOverview(scope, 'trace-no-db'),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'WORKBENCH_DATABASE_UNAVAILABLE' &&
      (error as Error & { trace_id?: string }).trace_id === 'trace-no-db',
  );
});

test('workbench projection selects the fields rendered by the board and avoids join multiplication', async () => {
  const fixture = fakeDb([]);
  const repository = new WorkbenchRepository(fixture.db);

  await repository.listOverview(scope, 'trace-overview-counts');
  await repository.listWorkItems(scope, 'trace-board-fields');
  await repository.listSessions(scope, 'trace-session-counts');

  const overviewQuery = fixture.calls[0]?.text ?? '';
  const workItemsQuery = fixture.calls[1]?.text ?? '';
  const sessionsQuery = fixture.calls[2]?.text ?? '';
  assert.match(overviewQuery, /COUNT\(DISTINCT w\.id\)/);
  assert.match(workItemsQuery, /w\.description/);
  assert.match(workItemsQuery, /w\.classification/);
  assert.match(workItemsQuery, /w\.trace_id/);
  assert.match(sessionsQuery, /COUNT\(DISTINCT r\.run_id\)/);
  assert.match(sessionsQuery, /COUNT\(DISTINCT t\.tool_call_id\)/);
});

test('OIDC verifier accepts a signed RS256 token and rejects a bad signature', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const base64Url = (value: string) => Buffer.from(value).toString('base64url');
  const header = base64Url(JSON.stringify({ alg: 'RS256', kid: 'test-key', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      iss: 'https://issuer.example',
      sub: 'user-1',
      aud: 'Base',
      exp: 2_000,
    }),
  );
  const signingInput = header + '.' + payload;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  const token = signingInput + '.' + signature;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/.well-known/openid-configuration')) {
      return new Response(
        JSON.stringify({
          issuer: 'https://issuer.example/',
          jwks_uri: 'https://issuer.example/jwks',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key', kty: 'RSA' }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const verifier = new OidcTokenVerifier({
    issuer: 'https://issuer.example/',
    audience: 'Base',
    fetch_impl: fetchImpl,
    clock: () => 1_000_000,
  });
  const claims = await verifier.verifyAuthorization('Bearer ' + token);
  assert.equal(claims.sub, 'user-1');
  await assert.rejects(() => verifier.verifyAuthorization('Bearer ' + token.slice(0, -2) + 'xx'));
});
