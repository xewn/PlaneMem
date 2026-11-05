import postgres from 'postgres';
import type { SessionCurrentSnapshot, SessionCurrentStore, SessionCurrentTarget } from './session-current.js';

/** A fresh READ COMMITTED statement reads one exact owning row, including other processes' commits.
 * It neither hydrates the session-service Map nor consults the immutable operation result tables. */
export class PostgresSessionCurrentStore implements SessionCurrentStore {
  constructor(private readonly db: ReturnType<typeof postgres>) {}

  async read(target: Readonly<SessionCurrentTarget>): Promise<SessionCurrentSnapshot | null> {
    let snapshot: SessionCurrentSnapshot | null = null;
    await this.db.begin('isolation level read committed read only', async sql => {
      await sql`SET LOCAL statement_timeout = '5s'`;
      await sql`SET LOCAL lock_timeout = '2s'`;
      const rows = await sql<Array<{ session_json: string | null; observed_at: string }>>`
        SELECT CASE WHEN octet_length(image::text) <= 65536 AND timestamps_exact
                    THEN image::text ELSE NULL END AS session_json,
               to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at
        FROM (
          SELECT (jsonb_build_object(
            'schema_version', 1, 'tenant_id', tenant_id, 'workspace_id', workspace_id,
            'project_id', project_id, 'session_id', session_id, 'client_id', client_id,
            'actor_id', actor_id, 'status', status,
            'version', version, 'trace_id', trace_id, 'source_refs', source_refs,
            'started_at', to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          ) || CASE WHEN parent_session_id IS NULL THEN '{}'::jsonb
                    ELSE jsonb_build_object('parent_session_id', parent_session_id) END
            || CASE WHEN ended_at IS NULL THEN '{}'::jsonb
                    ELSE jsonb_build_object('ended_at', to_char(ended_at AT TIME ZONE 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END) AS image,
          (date_trunc('milliseconds', started_at) = started_at AND
            (ended_at IS NULL OR date_trunc('milliseconds', ended_at) = ended_at)) AS timestamps_exact
          FROM wcp_sessions
          WHERE session_id = ${target.session_id} AND tenant_id = ${target.tenant_id}
            AND workspace_id = ${target.workspace_id} AND project_id = ${target.project_id}
            AND actor_id = ${target.actor_id} AND client_id = ${target.client_id}
          LIMIT 1
        ) AS selected_session
      `;
      if (rows[0]) {
        if (rows[0].session_json === null) throw new Error('Current session exceeds protocol limits');
        snapshot = { session_json: rows[0].session_json, observed_at: rows[0].observed_at };
      }
    });
    return snapshot;
  }
}
