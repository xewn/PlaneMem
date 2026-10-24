import assert from 'node:assert/strict';
import test from 'node:test';
import { runIdentityAuditLiveProbe } from '../../tools/run-identity-audit-live-probe.mjs';

test('P6 live identity/audit probe verifies Keycloak claims and a cleaned-up audit round trip', async () => {
  const sqlCalls = [];
  const compose = async (command) => {
    sqlCalls.push(command);
    const sql = command.at(-1);
    if (sql.startsWith('SELECT to_regclass')) return { status: 0, stdout: 'wcp_audit_records\n' };
    if (sql.includes('trace-identity-audit-test-audit')) return { status: 0, stdout: '1\n' };
    if (sql.startsWith('SELECT count(*)')) return { status: 0, stdout: '0\n' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const request = async () => ({
    status: 200,
    body: {
      access_token: `header.${Buffer.from(
        JSON.stringify({ iss: 'http://keycloak/realms/master', azp: 'admin-cli' }),
      ).toString('base64url')}.signature`,
      token_type: 'Bearer',
      expires_in: 60,
    },
  });
  const result = await runIdentityAuditLiveProbe({
    keycloak_url: 'http://keycloak.test',
    trace_id: 'trace-identity-audit-test',
    request,
    run_compose: compose,
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.steps.length, 7);
  assert.deepEqual(
    result.steps.map((step) => step.name),
    [
      'identity.keycloak.token',
      'identity.keycloak.claims',
      'audit.table',
      'audit.roundtrip.write',
      'audit.roundtrip.read',
      'audit.roundtrip.cleanup',
      'audit.roundtrip.cleanup.verify',
    ],
  );
  assert.equal(sqlCalls.length, 5);
  assert.match(sqlCalls[0].at(-1), /to_regclass/);
  assert.match(sqlCalls[2].at(-1), /SELECT count/);
});
