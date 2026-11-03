import {
  ContractError,
  parseCheckpointReadQuery,
  parseCheckpointHistoryQuery,
} from '@planemem/contracts';
import { WcpClient, FetchWcpTransport } from '@planemem/sdk';

/** Network full reads share the SDK's decoded-body bounds and complete local deadline. */
export async function callCheckpointRead(
  command: 'checkpoints get' | 'checkpoints history' | 'checkpoints list',
  input: unknown,
  options: {
    base: string;
    token: string;
    trace: string;
    scope: { tenant_id: string; workspace_id: string; project_id: string };
    key?: string | undefined;
  },
) {
  let client: WcpClient;
  let query;
  try {
    if (options.key !== undefined) throw new TypeError();
    query =
      command === 'checkpoints get'
        ? parseCheckpointReadQuery(input)
        : parseCheckpointHistoryQuery(input);
    const base = new URL(options.base);
    const token = options.token.trim();
    if (base.hash || base.search || !token) throw new TypeError();
    new Headers({ authorization: 'Bearer ' + token });
    client = new WcpClient(
      new FetchWcpTransport({ base_url: base.href, access_token: () => token, timeout_ms: 30_000 }),
      { ...options.scope, trace_id: options.trace },
    );
  } catch {
    throw new ContractError(
      'USAGE_ERROR',
      'Supply a session ULID and checkpoint ULID for get, or session ULID and optional before_revision for history; no write key',
      { trace_id: options.trace, retryable: false },
    );
  }
  if ('checkpoint_id' in query)
    return client.getSessionCheckpoint(query.session_id, query.checkpoint_id);
  if (command === 'checkpoints list') return client.listCheckpoints(query);
  return client.listSessionCheckpoints(
    query.session_id,
    query.before_revision === undefined ? {} : { before_revision: query.before_revision },
  );
}
