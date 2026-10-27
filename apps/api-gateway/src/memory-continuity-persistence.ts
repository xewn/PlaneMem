import postgres from 'postgres';
import type { PreparedMemoryOperation, PreparedMemoryStore } from './memory-continuity.js';

/** This table owns only the frozen outbound command, never a second copy of ai-memory business state. */
export class PostgresPreparedMemoryStore implements PreparedMemoryStore {
  constructor(private readonly db: ReturnType<typeof postgres>) {}
  async isReady(): Promise<boolean> {
    try {
      await this.db`SELECT operation_key, fingerprint, record FROM wcp_memory_operations LIMIT 0`;
      return true;
    } catch {
      return false;
    }
  }
  async get(key: string): Promise<PreparedMemoryOperation | null> {
    const rows = await this.db<
      { record: PreparedMemoryOperation }[]
    >`SELECT record FROM wcp_memory_operations WHERE operation_key = ${key}`;
    return rows[0]?.record ?? null;
  }
  async putIfAbsent(record: PreparedMemoryOperation): Promise<PreparedMemoryOperation> {
    let original!: PreparedMemoryOperation;
    await this.db.begin(async (sql) => {
      await sql`INSERT INTO wcp_memory_operations (operation_key, fingerprint, record)
        VALUES (${record.operation_key}, ${record.fingerprint}, ${sql.json(record as unknown as postgres.JSONValue)})
        ON CONFLICT (operation_key) DO NOTHING`;
      const rows = await sql<
        { record: PreparedMemoryOperation }[]
      >`SELECT record FROM wcp_memory_operations WHERE operation_key = ${record.operation_key}`;
      if (!rows[0]) throw new Error('Prepared original memory command is not readable');
      original = rows[0].record;
    });
    return original;
  }
}
