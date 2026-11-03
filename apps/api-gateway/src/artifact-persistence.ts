import {
  PersistentArtifactService,
  S3ArtifactObjects,
  type ArtifactDatabase,
  type ArtifactSqlTransaction,
  type ImmutableArtifactObjects,
  type S3ArtifactOptions,
} from '@planemem/artifact-service';
import type postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;
type Parameter = string | number | boolean | null | Date;

export interface ArtifactPostgresOptions {
  statement_timeout_ms?: number;
  lock_timeout_ms?: number;
  idle_transaction_timeout_ms?: number;
}

export interface ArtifactPersistenceOptions extends ArtifactPostgresOptions {
  max_bytes?: number;
}

/** Uses a caller-owned postgres pool. Construction performs no I/O and never runs migrations. */
export class PostgresArtifactDatabase implements ArtifactDatabase {
  private readonly statementTimeout: number;
  private readonly lockTimeout: number;
  private readonly idleTimeout: number;

  constructor(
    private readonly database: Sql,
    options: ArtifactPostgresOptions = {},
  ) {
    if (typeof database?.begin !== 'function' || typeof database.unsafe !== 'function')
      throw new TypeError('Supply a root postgres client, not a transaction client');
    this.statementTimeout = duration(options.statement_timeout_ms ?? 30_000);
    this.lockTimeout = duration(options.lock_timeout_ms ?? 5_000);
    this.idleTimeout = duration(options.idle_transaction_timeout_ms ?? 120_000);
    if (this.lockTimeout > this.statementTimeout)
      throw new TypeError('Artifact lock timeout must not exceed statement timeout');
  }

  /** Standalone queries receive the same connection-local limits as service transactions. */
  query<T>(text: string, parameters: unknown[]): Promise<T[]> {
    // Snapshot inputs before waiting for a connection from the pool.
    const values = sqlParameters(parameters);
    return this.transaction((tx) => tx.query<T>(text, values));
  }

  async transaction<T>(work: (transaction: ArtifactSqlTransaction) => Promise<T>): Promise<T> {
    // Explicit isolation avoids inheriting serializable/repeatable-read pool defaults.
    // Boxing preserves arbitrary callback results, including arrays, across postgres.begin.
    const committed = await this.database.begin('isolation level read committed', async (sql) => {
      await sql.unsafe(
        `SELECT set_config('statement_timeout', $1, true),
                set_config('lock_timeout', $2, true),
                set_config('idle_in_transaction_session_timeout', $3, true)`,
        [String(this.statementTimeout), String(this.lockTimeout), String(this.idleTimeout)],
      );
      let active = true;
      const transaction: ArtifactSqlTransaction = {
        query: async <Row>(text: string, parameters: unknown[]): Promise<Row[]> => {
          if (!active) throw new Error('Artifact transaction is no longer active');
          const values = sqlParameters(parameters);
          // SQL text is service-owned. Only values use this driver parameter array.
          const rows = await sql.unsafe<Row[]>(text, values);
          return Array.from(rows);
        },
      };
      try {
        return { value: await work(transaction) };
      } finally {
        active = false;
      }
    });
    // postgres.begin resolves after COMMIT; rollback/unknown COMMIT propagates unchanged.
    // Do not retry the callback or convert connection failures to an empty result.
    return committed.value;
  }
}

/** Explicit composition only: no HTTP routes, pool creation, background work or memory fallback. */
export function createPersistentArtifactService(
  database: Sql,
  objects: ImmutableArtifactObjects,
  options: ArtifactPersistenceOptions = {},
): PersistentArtifactService {
  if (typeof objects?.putIfAbsent !== 'function' || typeof objects.read !== 'function')
    throw new TypeError('Supply an immutable artifact object adapter');
  return new PersistentArtifactService(
    new PostgresArtifactDatabase(database, options),
    objects,
    options.max_bytes,
  );
}

/** Compose both real adapters explicitly without opening a connection or enabling routes. */
export function createS3PersistentArtifactService(
  database: Sql,
  objectOptions: S3ArtifactOptions,
  databaseOptions: ArtifactPostgresOptions = {},
): PersistentArtifactService {
  return createPersistentArtifactService(database, new S3ArtifactObjects(objectOptions), {
    ...databaseOptions,
    max_bytes: objectOptions.max_bytes ?? 64 * 1024 * 1024,
  });
}

function duration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
    throw new TypeError('Artifact database timeouts must be positive PostgreSQL milliseconds');
  return value;
}

function sqlParameters(values: unknown[]): Parameter[] {
  if (!Array.isArray(values)) throw new TypeError('Artifact SQL parameters must be an array');
  return Array.from(values, (value): Parameter => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
    if (value instanceof Date && Number.isFinite(value.getTime())) return new Date(value.getTime());
    // JSON is serialized by the domain service with an explicit ::jsonb SQL cast.
    // Reject undefined, sparse slots and mutable objects instead of coercing them.
    throw new TypeError('Unsupported artifact SQL parameter');
  });
}
