import {
  ContractError,
  parseSyncCursorQuery,
  parseSyncCursorEnvelope,
  parseSyncAcknowledgement,
  parseSyncAcknowledgementEnvelope,
  assertSyncCommandIdentity,
  type SyncAcknowledgement,
  type SyncAcknowledgementEnvelope,
  type SyncCursorEnvelope,
} from '@planemem/contracts';
import type { CommandRouter } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';
import { syncReaderIdentity } from './sync-reader.js';
import { withSyncDatabase, acknowledgeSyncCursor } from './sync-persistence.js';

export function registerSyncCursor(router: CommandRouter, db: RuntimeSql | undefined) {
  router.register('sync.cursor', async (request) => {
    const context = structuredClone(request.context);
    const identity = syncReaderIdentity(context);
    try {
      if (
        Object.keys(parseSyncCursorQuery(request.input)).length ||
        context.idempotency_key !== undefined ||
        context.expected_version !== undefined
      )
        throw new TypeError();
    } catch {
      throw new ContractError(
        'INVALID_INPUT',
        'Current sync cursor takes no arguments or write conditions',
        { trace_id: context.trace_id },
      );
    }
    const state = await withSyncDatabase(db, context.trace_id, (store) =>
      store.begin('isolation level repeatable read read only', async (tx) => {
        const [saved] = await tx<{ cursor: string | null; recorded: boolean }[]>`
          SELECT a.server_cursor::text AS cursor, a.server_cursor IS NOT NULL AS recorded
            FROM wcp_projects p LEFT JOIN wcp_sync_acknowledgements a
              ON a.tenant_id = p.tenant_id AND a.workspace_id = p.workspace_id AND a.project_id = p.id
              AND a.actor_id = ${identity.actor_id} AND a.client_id = ${identity.client_id}
           WHERE p.id = ${identity.project_id} AND p.tenant_id = ${identity.tenant_id} AND p.workspace_id = ${identity.workspace_id}
             AND p.deleted_at IS NULL AND p.classification IN ('public', 'internal', 'confidential', 'restricted')
             AND (p.classification <> 'restricted' OR ${context.capability.includes('data.restricted.read')})`;
        if (!saved)
          throw new ContractError(
            'NOT_FOUND',
            'The project cursor is unavailable in the current scope',
            { trace_id: context.trace_id },
          );
        if (
          typeof saved.recorded !== 'boolean' ||
          (saved.recorded
            ? typeof saved.cursor !== 'string' ||
              !/^(0|[1-9][0-9]{0,15})$/.test(saved.cursor) ||
              !Number.isSafeInteger(Number(saved.cursor))
            : saved.cursor !== null)
        )
          throw new ContractError('SYNC_CURSOR_INVALID', 'Stored acknowledgement is invalid', {
            trace_id: context.trace_id,
          });
        return { cursor: saved.recorded ? Number(saved.cursor) : 0, recorded: saved.recorded };
      }),
    );
    syncReaderIdentity(context);
    let result: SyncCursorEnvelope;
    try {
      result = parseSyncCursorEnvelope(
        {
          schema_version: 1,
          trace_id: context.trace_id,
          source_refs: state.recorded
            ? [{ type: 'sync-cursor', id: identity.client_id + ':' + state.cursor }]
            : [],
          server_cursor: state.cursor,
          data: {
            identity,
            ...state,
            expires_at: new Date(context.token_expires_at!).toISOString(),
            permissions: { acknowledge_sync: true },
          },
        },
        context,
        context.trace_id,
        identity,
      );
    } catch {
      throw new ContractError(
        'SYNC_CURSOR_INVALID',
        'Current acknowledgement could not be represented',
        { trace_id: context.trace_id },
      );
    }
    syncReaderIdentity(context);
    return result;
  });
  router.register('sync.ack', async (request) => {
    const context = structuredClone(request.context);
    const identity = syncReaderIdentity(context);
    let command: SyncAcknowledgement;
    try {
      if (context.idempotency_key !== undefined || context.expected_version !== undefined)
        throw new TypeError();
      command = parseSyncAcknowledgement(request.input);
    } catch {
      throw new ContractError(
        'INVALID_INPUT',
        'Supply the saved expected_identity and cursor without a key or version',
        { trace_id: context.trace_id },
      );
    }
    try {
      assertSyncCommandIdentity(command.expected_identity, identity);
    } catch {
      throw new ContractError(
        'DENIED',
        'The saved consumer identity differs from the verified sender',
        { trace_id: context.trace_id },
      );
    }
    // Prepare the entire response before writing; no late metadata serialization can alter the command.
    let result: SyncAcknowledgementEnvelope;
    try {
      result = parseSyncAcknowledgementEnvelope(
        {
          schema_version: 1,
          trace_id: context.trace_id,
          source_refs: [{ type: 'sync-cursor', id: identity.client_id + ':' + command.cursor }],
          server_cursor: command.cursor,
          data: { identity, client_id: identity.client_id, cursor: command.cursor },
        },
        command,
        context.trace_id,
      );
    } catch {
      throw new ContractError(
        'SYNC_CURSOR_INVALID',
        'The acknowledgement response could not be represented',
        { trace_id: context.trace_id },
      );
    }
    await withSyncDatabase(db, context.trace_id, (store) =>
      acknowledgeSyncCursor(store, context, command.cursor),
    );
    syncReaderIdentity(context);
    return result;
  });
}
