import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { ContractError } from '@planemem/contracts';
import { ContinuationService, SessionService } from '@planemem/session-service';
import type { CommandRequest, CommandResult } from './router.js';
import type {
  OperationRecord,
  OperationTransaction,
  OperationTransactions,
} from './continuity-operations.js';
import { PostgresSessionStore } from './session-persistence.js';
import { createSessionCommands } from './session-commands.js';

/** All upgraded WCP write routes share this transaction and lock. Never hold it across MCP calls. */
export class PostgresOperationTransactions implements OperationTransactions {
  constructor(private readonly db: ReturnType<typeof postgres>) {}

  async run<T>(work: (transaction: OperationTransaction) => Promise<T>): Promise<T> {
    let result!: T;
    await this.db.begin(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(1867584, 1)`;
      const commands = await this.commands(sql);
      result = await work({
        execute: (request) => commands.execute(request),
        find: async (key) => {
          const rows = await sql<{ record: OperationRecord }[]>`
            SELECT record FROM wcp_continuity_operations WHERE operation_key = ${key} ORDER BY dispatch_attempt`;
          return rows.map((row) => row.record);
        },
        insert: async (record) => {
          await sql`INSERT INTO wcp_continuity_operations (operation_key, dispatch_attempt, fingerprint, record)
            VALUES (${record.operation_key}, ${record.dispatch_attempt}, ${record.fingerprint}, ${sql.json(record as unknown as postgres.JSONValue)})`;
        },
      });
    });
    return result;
  }

  async executeLegacy(request: CommandRequest): Promise<CommandResult> {
    let result!: CommandResult;
    await this.db.begin(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(1867584, 1)`;
      const context = request.context;
      const rawKey = context.idempotency_key ?? request.input.idempotency_key;
      const key =
        typeof rawKey !== 'string'
          ? null
          : hash([
              context.tenant_id,
              context.workspace_id,
              context.project_id,
              context.actor_id,
              context.client_id,
              rawKey,
            ]);
      const fingerprint = hash({
        operation: request.operation,
        input: request.input,
        expected_version: context.expected_version ?? null,
      });
      if (key) {
        const previous = await sql<
          { fingerprint: string; result: CommandResult }[]
        >`SELECT fingerprint, result FROM wcp_legacy_session_commands WHERE command_key = ${key}`;
        if (previous[0]) {
          if (previous[0].fingerprint !== fingerprint)
            throw new ContractError(
              'IDEMPOTENCY_KEY_REUSED',
              'Command key belongs to another request',
              { trace_id: context.trace_id, retryable: false },
            );
          result = { ...previous[0].result, trace_id: context.trace_id };
          return;
        }
      }
      result = await (await this.commands(sql)).execute(request);
      if (key)
        await sql`INSERT INTO wcp_legacy_session_commands (command_key, fingerprint, result)
          VALUES (${key}, ${fingerprint}, ${sql.json(result as unknown as postgres.JSONValue)})`;
    });
    return result;
  }

  private async commands(sql: postgres.TransactionSql) {
    const store = new PostgresSessionStore(sql);
    const sessions = new SessionService(store);
    const continuation = new ContinuationService(sessions, store);
    await sessions.hydrate();
    await continuation.hydrate();
    return createSessionCommands(sessions, continuation);
  }
}
function hash(value: unknown): string {
  function stable(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(stable);
    if (input && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, stable(item)]),
      );
    return input;
  }
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}
