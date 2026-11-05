import postgres from 'postgres';
import type { SessionCurrentTarget } from './session-current.js';
import { readSessionCurrentInTransaction } from './session-current-persistence.js';
import type { SessionOriginRow, SessionOriginSelection, SessionOriginSnapshot, SessionOriginStore } from './session-origin-bridge.js';

/** Preserved old tables only. This adapter cannot manufacture an old receipt, migrate records,
 * change a session, close an unknown operation, or run either branch's writers. */
export class PostgresSessionOriginStore implements SessionOriginStore {
  constructor(private readonly db: ReturnType<typeof postgres>) {}

  async read(target: Readonly<SessionCurrentTarget>, selection: Readonly<SessionOriginSelection>,
    signal?: AbortSignal): Promise<SessionOriginSnapshot> {
    let result: SessionOriginSnapshot | undefined;
    const guard = () => { if (signal?.aborted) throw new Error('Origin read cancelled'); };
    guard();
    await this.db.begin('isolation level repeatable read read only', async sql => {
      await sql`SET LOCAL statement_timeout = '5s'`; guard();
      await sql`SET LOCAL lock_timeout = '2s'`; guard();
      // The visible current session is read first. Never expose an old record for an invisible
      // project or a different owner; the domain interpreter also compares every original row.
      const session = await readSessionCurrentInTransaction(sql, target); guard();
      if (!session) throw new Error('Origin is unavailable');
      const rows = await sql<SessionOriginRow[]>`
        WITH bounded AS (
          SELECT operation_key, dispatch_attempt, fingerprint, record::text AS raw
          FROM wcp_continuity_operations WHERE operation_key = ${selection.operation_key}
          ORDER BY dispatch_attempt LIMIT 1025
        ), sized AS (
          SELECT *, sum(octet_length(raw)) OVER () AS total_bytes FROM bounded
        )
        SELECT operation_key, dispatch_attempt, fingerprint,
          CASE WHEN total_bytes <= 2097152 AND octet_length(raw) <= 524288
               THEN raw ELSE NULL END AS record_json
        FROM sized ORDER BY dispatch_attempt
      `; guard();
      // No prefix-based migration matching: 011_original_operations and 011_handoff_claim_actor
      // are different rows. Preserve the exact sorted database text and require approved digest.
      const inventory = await sql<Array<{ inventory_json: string | null }>>`
        WITH bounded AS (SELECT version, checksum FROM schema_migrations ORDER BY version COLLATE "C" LIMIT 513),
          image AS (SELECT jsonb_agg(jsonb_build_object('version', version, 'checksum', checksum)
            ORDER BY version COLLATE "C")::text AS raw, count(*) AS count FROM bounded)
        SELECT CASE WHEN count BETWEEN 1 AND 512 AND octet_length(raw) <= 262144 THEN raw ELSE NULL END AS inventory_json FROM image
      `; guard();
      const marker = await sql<Array<{ idempotency_key: string | null }>>`
        SELECT idempotency_key FROM wcp_sessions WHERE session_id = ${target.session_id}
          AND tenant_id = ${target.tenant_id} AND workspace_id = ${target.workspace_id}
          AND project_id = ${target.project_id} AND actor_id = ${target.actor_id} AND client_id = ${target.client_id}
      `; guard();
      if (!inventory[0]?.inventory_json || marker.length !== 1) throw new Error('Origin source is unavailable');
      result = { records: rows.map(row => ({ ...row })), migration_inventory_json: inventory[0].inventory_json,
        session, session_idempotency_key: marker[0]!.idempotency_key };
    });
    guard();
    if (!result) throw new Error('Origin transaction returned no observation');
    return result;
  }
}
