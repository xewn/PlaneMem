// Remote acceptance harness only. Business effects and proofs use the public API;
// this control server supplies fault injection, observations and process restart.
import { createServer } from 'node:http';
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
  throw new Error('Remote k3s acceptance only');
const databaseUrl = `postgres://planemem:${encodeURIComponent(process.env.PGPASSWORD)}@127.0.0.1:5432/planemem`;
const sql = postgres(databaseUrl, { max: 2, connect_timeout: 5 });
const logs = [],
  processes = [];
let child;
async function start() {
  const entries = [];
  logs.push(entries);
  child = spawn(process.execPath, ['dist/apps/api-gateway/src/server.js'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: '6080',
      HOST: '127.0.0.1',
      MEMORY_PROVIDER_MODE: '',
      MEMORY_REQUIRED: 'false',
      OPA_URL: '',
      CONTINUITY_ENDPOINT_REF: 'planemem:p02-integration',
      CONTINUITY_CONFIGURATION_DIGEST: 'c'.repeat(64),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processes.push({ pid: child.pid, startedAt: new Date().toISOString() });
  child.stdout.on('data', (bytes) => entries.push(bytes.toString()));
  child.stderr.on('data', (bytes) => entries.push(bytes.toString()));
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`PlaneMem exited: ${entries.join('')}`);
    try {
      if ((await fetch('http://127.0.0.1:6080/health')).ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error('PlaneMem startup timeout');
}
async function stop() {
  if (child?.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await exited;
  }
}
async function exportEvidence() {
  for (let index = 0; index < logs.length; index++)
    await writeFile(`/data/planemem-host-${index}.log`, logs[index].join(''));
  const observations = {
    processes,
    node: process.env.FACTORY_VALIDATION_NODE_IP,
    operations:
      await sql`SELECT * FROM wcp_continuity_operations ORDER BY operation_key,dispatch_attempt`,
    sessions: await sql`SELECT * FROM wcp_sessions ORDER BY session_id`,
    runs: await sql`SELECT * FROM wcp_agent_runs ORDER BY run_id`,
    audits: await sql`SELECT * FROM wcp_audit_records ORDER BY occurred_at,audit_id`,
  };
  await writeFile('/data/planemem-observations.json', JSON.stringify(observations, null, 2));
  return { exported: true, processes };
}
for (const file of (await readdir('migrations')).filter((file) => file.endsWith('.sql')).sort())
  await sql.unsafe(await readFile(`migrations/${file}`, 'utf8'));
await sql`INSERT INTO wcp_tenants(id,name,classification) VALUES ('p02-t','P02 integration fixture','internal')`;
await sql`INSERT INTO wcp_workspaces(id,tenant_id,name,classification) VALUES ('p02-w','p02-t','P02 fixture','internal')`;
await sql`INSERT INTO wcp_projects(id,tenant_id,workspace_id,name,external_id,classification) VALUES ('p02-p','p02-t','p02-w','P02 fixture','p02-external','internal')`;
await sql.unsafe(`CREATE TABLE p02_fixture_faults(operation_key TEXT PRIMARY KEY, mode TEXT NOT NULL);
  CREATE FUNCTION p02_fixture_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE selected_mode TEXT; BEGIN
    SELECT mode INTO selected_mode FROM p02_fixture_faults WHERE operation_key=NEW.operation_key;
    IF selected_mode='fail' THEN RAISE EXCEPTION 'injected receipt failure'; END IF;
    IF selected_mode='delay' THEN PERFORM pg_sleep(2.5); END IF;
    RETURN NEW;
  END $$;
  CREATE TRIGGER p02_fixture_receipt_fault BEFORE INSERT ON wcp_continuity_operations
  FOR EACH ROW EXECUTE FUNCTION p02_fixture_receipt_fault()`);
await start();
const control = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1:6090');
    let result;
    if (request.method === 'GET' && url.pathname === '/health') result = { ready: true };
    else if (request.method === 'GET' && url.pathname === '/stats') {
      const records =
        await sql`SELECT record FROM wcp_continuity_operations WHERE operation_key=${url.searchParams.get('key')} ORDER BY dispatch_attempt`;
      const count =
        await sql`SELECT count(*)::int AS n FROM wcp_audit_records WHERE trace_id=${url.searchParams.get('trace')} AND action='session.continuity.execute'`;
      result = { records, executeRequests: count[0].n };
    } else if (request.method === 'POST') {
      let text = '';
      for await (const bytes of request) text += bytes;
      const body = text ? JSON.parse(text) : {};
      if (url.pathname === '/schema') {
        if (body.available === false)
          await sql.unsafe(
            'ALTER TABLE wcp_continuity_operations RENAME TO p02_fixture_hidden_operations',
          );
        else if (body.available === true)
          await sql.unsafe(
            'ALTER TABLE p02_fixture_hidden_operations RENAME TO wcp_continuity_operations',
          );
        else throw new Error('Invalid schema fixture');
        result = { available: body.available };
      } else if (url.pathname === '/fault') {
        if (typeof body.key !== 'string' || !['fail', 'delay', 'none'].includes(body.mode))
          throw new Error('Invalid fault fixture');
        await sql`INSERT INTO p02_fixture_faults(operation_key,mode) VALUES (${body.key},${body.mode}) ON CONFLICT(operation_key) DO UPDATE SET mode=EXCLUDED.mode`;
        result = { configured: true };
      } else if (url.pathname === '/restart') {
        await stop();
        await start();
        result = { restarted: true, processes };
      } else if (url.pathname === '/export') result = await exportEvidence();
    }
    if (!result) {
      response.writeHead(404);
      response.end('{}');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result));
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: String(error) }));
  }
});
control.listen(6090, '127.0.0.1');
process.on('SIGTERM', async () => {
  await stop();
  await sql.end();
  control.close();
});
