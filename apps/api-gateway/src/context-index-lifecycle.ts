import { createHash } from 'node:crypto';
import {
  ContractError,
  parseLegacyContextListQuery,
  parseLegacyContextListPage,
  parseLegacyContextIdentity,
  parseLegacyContextMutation,
  parseLegacyContextMutationReceipt,
  parseLegacyContextStatus,
  parseLegacyContextStatusQuery,
  validateIdempotencyKey,
  type LegacyContextStatus,
  type LegacyContextMutationReceipt,
} from '@planemem/contracts';
import type { CommandRouter, RequestContext } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';

function unavailable(trace_id: string) {
  return new ContractError(
    'CONTEXT_PERSISTENCE_UNAVAILABLE',
    'Context index storage is unavailable',
    {
      trace_id,
      retryable: true,
    },
  );
}
function invalidReceipt(trace_id: string) {
  return new ContractError('SEARCH_RESULT_INVALID', 'Stored context index metadata is invalid', {
    trace_id,
  });
}
function readable(row: unknown, context: RequestContext) {
  if (
    !row ||
    typeof row !== 'object' ||
    !('classification' in row) ||
    (row.classification === 'restricted' && !context.capability.includes('data.restricted.read'))
  )
    throw new ContractError('NOT_FOUND', 'Context index record is not available in this scope', {
      trace_id: context.trace_id,
    });
}
function date(value: unknown): string | null {
  if (value === null) return null;
  if (!(value instanceof Date) && typeof value !== 'string') throw new TypeError('Invalid date');
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function status(
  row: Record<string, unknown>,
  context: RequestContext,
  id: string,
): LegacyContextStatus {
  try {
    if (typeof row.revision !== 'string' || !/^(0|[1-9][0-9]*)$/.test(row.revision))
      throw new Error();
    const expires_at = date(row.expires_at);
    const deleted_at = date(row.deleted_at);
    const checked_at = date(row.checked_at)!;
    return parseLegacyContextStatus(
      {
        id,
        tenant_id: context.tenant_id,
        workspace_id: context.workspace_id,
        project_id: context.project_id,
        revision: Number(row.revision),
        classification: row.classification,
        expires_at,
        deleted_at,
        updated_at: date(row.updated_at),
        checked_at,
        managed_by: id.startsWith('plane:') ? 'plane' : 'manual',
        state:
          deleted_at !== null
            ? 'deleted'
            : expires_at !== null && Date.parse(expires_at) <= Date.parse(checked_at)
              ? 'expired'
              : 'active',
      },
      id,
    );
  } catch {
    throw invalidReceipt(context.trace_id);
  }
}

export function registerContextIndexLifecycle(router: CommandRouter, db: RuntimeSql | undefined) {
  router.register('context.index.list', async ({ input, context }) => {
    let query;
    let after: string | undefined;
    let queryKey: string;
    try {
      query = parseLegacyContextListQuery(input);
      queryKey = createHash('sha256')
        .update(
          JSON.stringify([
            'legacy-index-list-v1',
            context.tenant_id,
            context.workspace_id,
            context.project_id,
            context.capability.includes('data.restricted.read'),
            query.query,
            query.state,
            query.managed_by,
          ]),
        )
        .digest('hex');
      if (query.cursor !== undefined) {
        const parts: unknown = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        if (!Array.isArray(parts) || parts.length !== 3 || parts[0] !== 1 || parts[1] !== queryKey)
          throw new Error('Cursor scope or filters changed; start from the first page');
        after = parseLegacyContextStatusQuery({ id: parts[2] }).id;
        if (
          Buffer.from(JSON.stringify([1, queryKey, after])).toString('base64url') !== query.cursor
        )
          throw new Error('Invalid index cursor');
      }
    } catch (error) {
      throw new ContractError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Invalid index list query',
        { trace_id: context.trace_id },
      );
    }
    if (!db) throw unavailable(context.trace_id);
    let rows;
    try {
      rows = await db`WITH read_clock AS MATERIALIZED (SELECT clock_timestamp() AS checked_at)
        SELECT h.id, h.revision::text AS revision, h.classification, h.expires_at,
          h.deleted_at, h.updated_at, read_clock.checked_at
        FROM wcp_context_hits h CROSS JOIN read_clock WHERE h.tenant_id = ${context.tenant_id}
          AND h.workspace_id = ${context.workspace_id} AND h.project_id = ${context.project_id}
          AND (${context.capability.includes('data.restricted.read')} OR h.classification <> 'restricted')
          AND EXISTS (SELECT 1 FROM wcp_projects p WHERE p.tenant_id = h.tenant_id AND p.workspace_id = h.workspace_id
            AND p.id = h.project_id AND p.deleted_at IS NULL
            AND (${context.capability.includes('data.restricted.read')} OR p.classification <> 'restricted'))
          AND strpos(lower(h.id), lower(${query.query})) > 0
          AND (${query.managed_by} = 'all' OR (left(h.id, 6) = 'plane:') = (${query.managed_by} = 'plane'))
          AND (${query.state} = 'all' OR (${query.state} = 'deleted' AND h.deleted_at IS NOT NULL)
            OR (${query.state} = 'expired' AND h.deleted_at IS NULL
              AND date_trunc('milliseconds', h.expires_at) <= date_trunc('milliseconds', read_clock.checked_at))
            OR (${query.state} = 'active' AND h.deleted_at IS NULL
              AND (h.expires_at IS NULL OR date_trunc('milliseconds', h.expires_at) > date_trunc('milliseconds', read_clock.checked_at))))
          AND (${after === undefined} OR h.id COLLATE "C" > ${after ?? ''} COLLATE "C")
        ORDER BY h.id COLLATE "C" LIMIT ${query.limit + 1}`;
    } catch {
      throw unavailable(context.trace_id);
    }
    try {
      const items = rows.slice(0, query.limit).map((row) => {
        if (typeof row.id !== 'string') throw new Error();
        return status(row, context, row.id);
      });
      const data = parseLegacyContextListPage(
        {
          scope: {
            tenant_id: context.tenant_id,
            workspace_id: context.workspace_id,
            project_id: context.project_id,
          },
          items,
          ...(rows.length > query.limit
            ? {
                next_cursor: Buffer.from(
                  JSON.stringify([1, queryKey, items[items.length - 1]!.id]),
                ).toString('base64url'),
              }
            : {}),
        },
        query,
      );
      return { schema_version: 1, trace_id: context.trace_id, source_refs: [], data };
    } catch {
      throw invalidReceipt(context.trace_id);
    }
  });
  router.register('context.index.status', async ({ input, context }) => {
    let query;
    try {
      query = parseLegacyContextStatusQuery(input);
    } catch (error) {
      throw new ContractError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Invalid index query',
        { trace_id: context.trace_id },
      );
    }
    if (!db) throw unavailable(context.trace_id);
    let row;
    try {
      [row] = await db`SELECT h.revision::text AS revision, h.classification, h.expires_at,
          h.deleted_at, h.updated_at, clock_timestamp() AS checked_at
        FROM wcp_context_hits h WHERE h.tenant_id = ${context.tenant_id}
          AND h.workspace_id = ${context.workspace_id} AND h.project_id = ${context.project_id} AND h.id = ${query.id}
          AND (${context.capability.includes('data.restricted.read')} OR h.classification <> 'restricted')
          AND EXISTS (SELECT 1 FROM wcp_projects p WHERE p.tenant_id = h.tenant_id
            AND p.workspace_id = h.workspace_id AND p.id = h.project_id AND p.deleted_at IS NULL
            AND (${context.capability.includes('data.restricted.read')} OR p.classification <> 'restricted'))`;
    } catch {
      throw unavailable(context.trace_id);
    }
    readable(row, context);
    return {
      schema_version: 1,
      trace_id: context.trace_id,
      source_refs: [],
      data: status(row!, context, query.id),
      index_permissions: {
        write:
          context.authenticated_client === true &&
          (context.roles?.includes('admin') === true ||
            context.capability.includes('context.write')),
      },
      index_identity: parseLegacyContextIdentity({
        tenant_id: context.tenant_id,
        workspace_id: context.workspace_id,
        project_id: context.project_id,
        actor_id: context.actor_id,
        client_id: context.client_id,
      }),
    };
  });

  for (const operation of ['delete', 'restore'] as const) {
    router.register('context.index.' + operation, async (request) => {
      const { context } = request;
      if (context.authenticated_client !== true)
        throw new ContractError('DENIED', 'Index changes require a verified client', {
          trace_id: context.trace_id,
        });
      let input;
      let key: string;
      try {
        const { idempotency_key, ...body } = request.input;
        key = validateIdempotencyKey(context.idempotency_key ?? idempotency_key);
        if (idempotency_key !== undefined && idempotency_key !== key)
          throw new Error('Request keys disagree');
        input = parseLegacyContextMutation(body);
        if (
          context.expected_version !== undefined &&
          context.expected_version !== input.expected_revision
        )
          throw new Error('Version preconditions disagree');
      } catch (error) {
        throw new ContractError(
          'INVALID_INPUT',
          error instanceof Error ? error.message : 'Invalid index mutation',
          { trace_id: context.trace_id },
        );
      }
      if (!db) throw unavailable(context.trace_id);
      const { tenant_id, workspace_id, project_id, actor_id, client_id, trace_id } = context;
      const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      let receipt: LegacyContextMutationReceipt;
      try {
        receipt = await db.begin(async (transaction) => {
          const tx = transaction as unknown as RuntimeSql;
          await tx`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['context-index-lifecycle', tenant_id, workspace_id, project_id, actor_id, client_id, operation, key])}, 0))`;
          // Same record lock as context.index; stale index writes cannot undo deletion.
          await tx`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['context-index', tenant_id, workspace_id, project_id, input.id])}, 0))`;
          const projects =
            await tx`SELECT id FROM wcp_projects WHERE tenant_id = ${tenant_id} AND workspace_id = ${workspace_id}
            AND id = ${project_id} AND deleted_at IS NULL
            AND (${context.capability.includes('data.restricted.read')} OR classification <> 'restricted') FOR SHARE`;
          if (!projects.length) readable(undefined, context);
          const [row] =
            await tx`SELECT revision::text AS revision, classification, expires_at, deleted_at, updated_at
            FROM wcp_context_hits WHERE tenant_id = ${tenant_id} AND workspace_id = ${workspace_id}
              AND project_id = ${project_id} AND id = ${input.id} FOR UPDATE`;
          readable(row, context);
          // Read the database clock after waiting for locks.
          const [clock] = await tx`SELECT clock_timestamp() AS checked_at`;
          const current = status({ ...row, checked_at: clock!.checked_at }, context, input.id);
          const [saved] = await tx`SELECT fingerprint, receipt FROM wcp_context_index_mutations
            WHERE tenant_id = ${tenant_id} AND workspace_id = ${workspace_id} AND project_id = ${project_id}
              AND actor_id = ${actor_id} AND client_id = ${client_id} AND operation = ${operation} AND request_key = ${key}`;
          if (saved) {
            if (saved.fingerprint !== fingerprint)
              throw new ContractError(
                'IDEMPOTENCY_KEY_REUSED',
                'Key belongs to another index command',
                { trace_id },
              );
            let previous: LegacyContextMutationReceipt;
            try {
              previous = parseLegacyContextMutationReceipt(saved.receipt, input, operation, key);
              if (
                previous.record.tenant_id !== tenant_id ||
                previous.record.workspace_id !== workspace_id ||
                previous.record.project_id !== project_id ||
                previous.record.revision > current.revision
              )
                throw new Error();
            } catch {
              throw invalidReceipt(trace_id);
            }
            readable(previous.record, context);
            return previous;
          }
          if (
            current.revision !== input.expected_revision ||
            (operation === 'restore') !== (current.deleted_at !== null)
          )
            throw new ContractError(
              'CONTEXT_INDEX_VERSION_CONFLICT',
              'Index revision or deletion state changed; read current status before a new command',
              { trace_id },
            );
          const [changed] = await tx`UPDATE wcp_context_hits SET revision = revision + 1,
              deleted_at = CASE WHEN ${operation} = 'delete' THEN clock_timestamp() ELSE NULL END,
              updated_at = clock_timestamp(), trace_id = ${trace_id}
            WHERE tenant_id = ${tenant_id} AND workspace_id = ${workspace_id} AND project_id = ${project_id}
              AND id = ${input.id} AND revision = ${input.expected_revision}
            RETURNING revision::text AS revision, classification, expires_at, deleted_at, updated_at`;
          if (!changed)
            throw new ContractError('CONTEXT_INDEX_VERSION_CONFLICT', 'Index revision changed', {
              trace_id,
            });
          const [finished] = await tx`SELECT clock_timestamp() AS checked_at`;
          const result = parseLegacyContextMutationReceipt(
            {
              operation,
              request_key: key,
              expected_revision: input.expected_revision,
              reason: input.reason,
              record: status({ ...changed, checked_at: finished!.checked_at }, context, input.id),
            },
            input,
            operation,
            key,
          );
          await tx`INSERT INTO wcp_context_index_mutations
            (tenant_id, workspace_id, project_id, actor_id, client_id, operation, request_key, fingerprint, trace_id, receipt)
            VALUES (${tenant_id}, ${workspace_id}, ${project_id}, ${actor_id}, ${client_id}, ${operation}, ${key}, ${fingerprint}, ${trace_id}, ${JSON.stringify(result)}::jsonb)`;
          return result;
        });
      } catch (error) {
        if (error instanceof ContractError) throw error;
        throw unavailable(trace_id);
      }
      return { schema_version: 1, trace_id, source_refs: [], data: receipt };
    });
  }
}
