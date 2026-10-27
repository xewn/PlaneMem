import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';

if (
  process.env.FACTORY_VALIDATION_ENVIRONMENT !== 'remote-k3s-contract-fixture' ||
  !['192.168.1.231', '192.168.1.232', '192.168.1.233'].includes(
    process.env.FACTORY_VALIDATION_NODE_IP,
  )
)
  throw new Error('This runtime acceptance must run on an approved remote k3s node');
const databaseUrl = `postgres://planemem:${encodeURIComponent(process.env.PGPASSWORD)}@127.0.0.1:5432/planemem`;
const sql = postgres(databaseUrl, { max: 2, connect_timeout: 5 });
const config = {
  protocol_version: 'p02-continuity-v1',
  endpoint_ref: 'p02-remote-session',
  configuration_digest: 'c'.repeat(64),
};
const headers = {
  'content-type': 'application/json',
  'x-tenant-id': 'p02-t',
  'x-workspace-id': 'p02-w',
  'x-project-id': 'p02-p',
  'x-actor-id': 'p02-actor',
  'x-client-id': 'p02-client',
  'x-capability': 'session.write',
  'x-trace-id': 'trace-p02-remote',
};
const children = new Set();
const logs = new Map();
const checks = [];
const check = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
function operation(key, action = 'session.start', payload = {}, revision) {
  return {
    ...config,
    operation_key: key,
    specification_digest: 'a'.repeat(64),
    dispatch_attempt: 1,
    action,
    payload,
    ...(revision === undefined ? {} : { expected_revision: revision }),
  };
}
async function call(port, path, body, status = 200, extraHeaders = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...headers, ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  return result.data ?? result;
}
async function proof(port, method, body, status = 200, extra = {}) {
  const result = await call(port, `/v1/continuity/${method}`, body, status, extra);
  return result?.data === null ? null : result;
}
async function start(port) {
  const child = spawn(process.execPath, ['dist/apps/api-gateway/src/server.js'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: String(port),
      HOST: '127.0.0.1',
      MEMORY_PROVIDER_MODE: '',
      MEMORY_REQUIRED: 'false',
      CONTINUITY_ENDPOINT_REF: config.endpoint_ref,
      CONTINUITY_CONFIGURATION_DIGEST: config.configuration_digest,
      OPA_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  const name = `host-${port}-${logs.size}`;
  const entries = [];
  logs.set(name, entries);
  child.stdout.on('data', (bytes) => entries.push(bytes.toString()));
  child.stderr.on('data', (bytes) => entries.push(bytes.toString()));
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`Host ${port} exited: ${entries.join('')}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return child;
    } catch {}
    await delay(100);
  }
  throw new Error(`Host ${port} did not become ready`);
}
async function stop(child) {
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await exited;
  }
  children.delete(child);
}
try {
  for (const file of (await readdir('migrations')).filter((file) => file.endsWith('.sql')).sort())
    await sql.unsafe(await readFile(`migrations/${file}`, 'utf8'));
  await sql`INSERT INTO wcp_tenants(id,name,classification) VALUES ('p02-t','P02 remote fixture','internal')`;
  await sql`INSERT INTO wcp_workspaces(id,tenant_id,name,classification) VALUES ('p02-w','p02-t','P02 fixture','internal')`;
  await sql`INSERT INTO wcp_projects(id,tenant_id,workspace_id,name,external_id,classification) VALUES ('p02-p','p02-t','p02-w','P02 fixture','p02-external','internal')`;
  let first = await start(5080),
    second = await start(5082);
  const capabilities = await call(5080, '/v1/continuity/capabilities', undefined, 200, {
    'x-capability': 'context.read',
  });
  assert.equal(capabilities.durable_operation_proof, true);
  assert.deepEqual(capabilities.actions, [
    'session.start',
    'session.run',
    'session.tool-call',
    'session.checkpoint',
    'session.end',
  ]);
  await proof(5080, 'execute', operation('memory', 'handoff.create'), 400);
  check('actual PostgreSQL capability enables only five WCP actions');

  const originalRequest = operation('original-start');
  const original = await proof(5080, 'execute', originalRequest);
  const session = original.result.data.session_id;
  const run = await proof(
    5080,
    'execute',
    operation(
      'original-run',
      'session.run',
      { session_id: session, model: 'fixture-no-model-call' },
      1,
    ),
  );
  await proof(
    5080,
    'execute',
    operation(
      'original-tool',
      'session.tool-call',
      {
        session_id: session,
        run_id: run.result.data.run_id,
        tool_name: 'fixture.read',
        status: 'succeeded',
      },
      2,
    ),
  );
  const checkpointRequest = operation(
    'original-checkpoint',
    'session.checkpoint',
    {
      session_id: session,
      completed: ['read original PRD'],
      in_progress: [],
      next_actions: ['architecture'],
      decisions: [],
      risks: [],
      open_questions: [],
    },
    3,
  );
  const checkpoint = await proof(5080, 'execute', checkpointRequest);
  const ended = await proof(
    5080,
    'execute',
    operation(
      'original-end',
      'session.end',
      { session_id: session, status: 'ended', approval_ref: 'fixture-independent-review' },
      3,
    ),
  );
  assert.equal(ended.revision, 4);
  assert.deepEqual(await proof(5082, 'query', originalRequest), original);
  assert.equal(
    JSON.stringify(await proof(5082, 'query', originalRequest)),
    JSON.stringify(original),
  );
  assert.deepEqual(await proof(5082, 'execute', originalRequest), original);
  assert.equal(original.revision, 1);
  check('five actions return immutable original results after current session changes');

  for (const extra of [
    { 'x-workspace-id': 'other' },
    { 'x-actor-id': 'other' },
    { 'x-client-id': 'other' },
  ])
    await proof(5080, 'query', originalRequest, 409, extra);
  await proof(
    5080,
    'execute',
    { ...originalRequest, payload: { parent_session_id: session } },
    409,
  );
  await proof(5080, 'execute', originalRequest, 403, { 'x-capability': '' });
  check('replay binds full scope actor client payload and rechecks current policy');

  const race = operation('two-hosts');
  const [a, b] = await Promise.all([proof(5080, 'execute', race), proof(5082, 'execute', race)]);
  assert.deepEqual(a, b);
  assert.equal(
    (
      await sql`SELECT count(*)::int AS n FROM wcp_sessions WHERE session_id=${a.result.data.session_id}`
    )[0].n,
    1,
  );
  const raceSession = a.result.data.session_id;
  const races = await Promise.all(
    [5080, 5082].map((port, i) =>
      fetch(`http://127.0.0.1:${port}/v1/continuity/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify(
          operation(`race-run-${i}`, 'session.run', { session_id: raceSession }, 1),
        ),
      }),
    ),
  );
  assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (await sql`SELECT count(*)::int AS n FROM wcp_agent_runs WHERE session_id=${raceSession}`)[0].n,
    1,
  );
  check('independent hosts share one receipt and conflicting revisions allow one run');

  await sql.unsafe(
    `CREATE FUNCTION p02_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation_key = 'receipt-fault' THEN RAISE EXCEPTION 'injected receipt insertion failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER p02_receipt_fault BEFORE INSERT ON wcp_continuity_operations FOR EACH ROW EXECUTE FUNCTION p02_receipt_fault()`,
  );
  const countBefore = (await sql`SELECT count(*)::int AS n FROM wcp_sessions`)[0].n;
  await proof(5080, 'execute', operation('receipt-fault'), 500);
  assert.equal((await sql`SELECT count(*)::int AS n FROM wcp_sessions`)[0].n, countBefore);
  assert.equal(await proof(5082, 'query', operation('receipt-fault')), null);
  await sql.unsafe(
    'DROP TRIGGER p02_receipt_fault ON wcp_continuity_operations; DROP FUNCTION p02_receipt_fault()',
  );
  await proof(5080, 'execute', operation('receipt-fault'));
  check('receipt insertion failure rolls back actual session and leaves query Unknown');

  const failingSession = await proof(5080, 'execute', operation('run-fault-session'));
  const sid = failingSession.result.data.session_id;
  await sql.unsafe(
    `CREATE FUNCTION p02_run_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected run insertion failure'; END $$; CREATE TRIGGER p02_run_fault BEFORE INSERT ON wcp_agent_runs FOR EACH ROW EXECUTE FUNCTION p02_run_fault()`,
  );
  const runFault = operation('run-fault', 'session.run', { session_id: sid }, 1);
  await proof(5080, 'execute', runFault, 500);
  assert.equal(
    Number((await sql`SELECT version FROM wcp_sessions WHERE session_id=${sid}`)[0].version),
    1,
  );
  assert.equal(await proof(5082, 'query', runFault), null);
  await sql.unsafe('DROP TRIGGER p02_run_fault ON wcp_agent_runs; DROP FUNCTION p02_run_fault()');
  await proof(5082, 'execute', runFault);
  check('run insertion failure rolls back session version in the same transaction');

  const closedRequest = operation('closed');
  assert.equal(await proof(5080, 'query', closedRequest), null);
  const closed = await proof(5080, 'close', closedRequest);
  assert.equal(closed.outcome, 'ConfirmedNoEffect');
  assert.deepEqual(await proof(5082, 'execute', closedRequest), closed);
  const next = { ...closedRequest, dispatch_attempt: 2 };
  const nextResult = await proof(5082, 'execute', next);
  assert.equal(nextResult.outcome, 'ConfirmedEffect');
  assert.deepEqual(await proof(5080, 'query', closedRequest), closed);
  check('persisted NoEffect fences delayed original attempt and isolates next attempt');

  await sql.unsafe(
    `CREATE FUNCTION p02_reply_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation_key = 'lost-reply' THEN PERFORM pg_sleep(0.5); END IF; RETURN NEW; END $$; CREATE TRIGGER p02_reply_delay BEFORE INSERT ON wcp_continuity_operations FOR EACH ROW EXECUTE FUNCTION p02_reply_delay()`,
  );
  const lost = operation('lost-reply');
  await assert.rejects(
    fetch('http://127.0.0.1:5080/v1/continuity/execute', {
      method: 'POST',
      headers,
      body: JSON.stringify(lost),
      signal: AbortSignal.timeout(150),
    }),
  );
  await delay(650);
  const recovered = await proof(5082, 'query', lost);
  assert.equal(recovered.outcome, 'ConfirmedEffect');
  assert.deepEqual(
    recovered,
    (await sql`SELECT record FROM wcp_continuity_operations WHERE operation_key='lost-reply'`)[0]
      .record.proof,
  );
  check('client loses response during real commit; query recovers stored original result');

  const legacySession = await call(5080, '/v1/sessions', {}, 200, {
    'idempotency-key': 'legacy-start',
  });
  const legacyId = legacySession.session_id;
  const interleaved = await Promise.all([
    fetch(`http://127.0.0.1:5080/v1/sessions/${legacyId}/runs`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'legacy-run' },
      body: JSON.stringify({ expected_version: 1 }),
    }),
    fetch('http://127.0.0.1:5082/v1/continuity/execute', {
      method: 'POST',
      headers,
      body: JSON.stringify(operation('new-run', 'session.run', { session_id: legacyId }, 1)),
    }),
  ]);
  assert.deepEqual(interleaved.map((r) => r.status).sort(), [200, 409]);
  assert.deepEqual(
    await call(5082, '/v1/sessions', {}, 200, { 'idempotency-key': 'legacy-start' }),
    legacySession,
  );
  check('legacy and continuity writers share transaction lock and original legacy replay');

  await stop(first);
  await stop(second);
  first = await start(5080);
  second = await start(5082);
  assert.deepEqual(await proof(5080, 'query', originalRequest), original);
  assert.deepEqual(await proof(5082, 'query', checkpointRequest), checkpoint);
  assert.deepEqual(await proof(5080, 'execute', lost), recovered);
  assert.deepEqual(await proof(5082, 'execute', closedRequest), closed);
  assert.deepEqual(await proof(5080, 'query', next), nextResult);
  assert.deepEqual(
    await call(5082, '/v1/sessions', {}, 200, { 'idempotency-key': 'legacy-start' }),
    legacySession,
  );
  check(
    'both API processes restart and preserve original proofs IDs revisions and closed attempts',
  );
  const records =
    await sql`SELECT record FROM wcp_continuity_operations ORDER BY operation_key,dispatch_attempt`;
  await writeFile('/data/operation-records.json', JSON.stringify(records, null, 2));
  await writeFile(
    '/data/result.json',
    JSON.stringify(
      {
        status: 'passed',
        checks,
        modelCalls: 0,
        scope:
          'actual WCP PostgreSQL session operations; fixture scope/identity; same-Pod restart only',
        memoryActionsEnabled: false,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error);
  await writeFile(
    '/data/result.json',
    JSON.stringify({ status: 'failed', checks, error: String(error) }, null, 2),
  );
  process.exitCode = 1;
} finally {
  try {
    await writeFile(
      '/data/final-operation-records.json',
      JSON.stringify(
        await sql`SELECT record FROM wcp_continuity_operations ORDER BY operation_key,dispatch_attempt`,
        null,
        2,
      ),
    );
  } catch {}
  for (const child of [...children]) await stop(child);
  for (const [name, entries] of logs) await writeFile(`/data/${name}.log`, entries.join(''));
  await sql.end();
}
