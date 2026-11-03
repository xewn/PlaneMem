import {
  ContractError,
  isSyncIdentifier,
  isUlid,
  validateSourceRef,
  parseConfirmContextItem,
  type ContextItemConfirmation,
  type ContextItemDocument,
  type ContextItemMutationReceipt,
  type ContextItemRevision,
  type ContextItemRevisionSummary,
  type ContextItemHistoryPage,
} from '@planemem/contracts';
import { fingerprint } from './idempotency.js';
import type { CommandRouter, RequestContext } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';

type HistoryRow = {
  item_id: string;
  item_version: number | string;
  operation: ContextItemRevisionSummary['operation'];
  title: string;
  classification: ContextItemRevisionSummary['classification'];
  status: ContextItemRevisionSummary['status'];
  archived_at: string | Date | null;
  snapshot_hash: string;
  actor_id: string | null;
  client_id: string | null;
  event_id: string | null;
  recorded_at: string | Date;
  confirmation_reason: string | null;
};

/** Call inside the item mutation's transaction, after taking its row lock. */
export async function recordContextRevision(
  db: RuntimeSql,
  context: RequestContext,
  item: ContextItemDocument,
  archived_at: string | null,
  change?: {
    operation: ContextItemMutationReceipt['operation'];
    event_id: string;
    confirmation_reason?: string;
  },
) {
  const hash = fingerprint({ item, archived_at });
  const rows = await db<{ snapshot_hash: string }[]>`INSERT INTO wcp_context_item_history
    (tenant_id, workspace_id, project_id, item_id, item_version, operation, title, classification, status,
      archived_at, item_document, snapshot_hash, actor_id, client_id, event_id, recorded_at, confirmation_reason)
    VALUES (${item.tenant_id}, ${item.workspace_id}, ${item.project_id}, ${item.id}, ${item.version},
      ${change?.operation ?? 'baseline'}, ${item.title}, ${item.classification}, ${item.status},
      ${archived_at}, ${JSON.stringify(item)}::jsonb, ${hash}, ${change ? context.actor_id : null},
      ${change ? context.client_id : null}, ${change?.event_id ?? null}, ${new Date().toISOString()}, ${change?.confirmation_reason ?? null})
    ON CONFLICT (tenant_id, workspace_id, project_id, item_id, item_version) DO NOTHING
    RETURNING snapshot_hash`;
  if (!rows.length) {
    const [previous] = await db<
      { snapshot_hash: string }[]
    >`SELECT snapshot_hash FROM wcp_context_item_history
      WHERE tenant_id = ${item.tenant_id} AND workspace_id = ${item.workspace_id}
        AND project_id = ${item.project_id} AND item_id = ${item.id} AND item_version = ${item.version}`;
    if (!previous || previous.snapshot_hash !== hash || change)
      throw fail(
        context,
        'CONTEXT_ITEM_HISTORY_CONFLICT',
        'This item version already has a different history record.',
      );
  }
}

export function registerContextItemHistory(
  router: CommandRouter,
  database: RuntimeSql | undefined,
) {
  for (const detail of [false, true]) {
    router.register(
      detail ? 'context.item.version.read' : 'context.item.history',
      async ({ input, context }) => {
        if (!isSyncIdentifier(input.item_id) || input.item_id === '.' || input.item_id === '..')
          throw fail(context, 'INVALID_INPUT', 'Invalid item_id');
        const allowed = detail ? ['item_id', 'version'] : ['item_id', 'before_version', 'limit'];
        if (Object.keys(input).some((key) => !allowed.includes(key)))
          throw fail(context, 'INVALID_INPUT', 'Unknown history query field');
        const version = detail ? positive(input.version, context, 'version') : undefined;
        const before =
          input.before_version === undefined
            ? null
            : positive(input.before_version, context, 'before_version');
        const limit = input.limit === undefined ? 25 : positive(input.limit, context, 'limit');
        if (limit > 100) throw fail(context, 'INVALID_INPUT', 'limit must not exceed 100');
        const id = input.item_id;
        const restricted = context.capability.includes('data.restricted.read');
        try {
          if (!database) throw new Error('No database');
          return await database.begin('isolation level repeatable read read only', async (db) => {
            // History is readable only while the current item remains visible in the same scope.
            const [current] = await db<
              { version: string | number; deleted_at: string | Date | null }[]
            >`SELECT version, deleted_at FROM wcp_context_items
            WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id}
              AND project_id = ${context.project_id} AND id = ${id} AND (${restricted} OR classification <> 'restricted')`;
            if (!current)
              throw fail(
                context,
                'CONTEXT_ITEM_NOT_FOUND',
                'Context item is unavailable in this project',
              );
            const currentVersion = storedPositive(current.version, context);
            if (detail) {
              const [row] = await db<
                (HistoryRow & { item_document: ContextItemDocument })[]
              >`SELECT * FROM wcp_context_item_history
              WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id}
                AND project_id = ${context.project_id} AND item_id = ${id} AND item_version = ${version!}
                AND item_version <= ${currentVersion} AND (${restricted} OR classification <> 'restricted')`;
              if (!row)
                throw fail(
                  context,
                  'CONTEXT_ITEM_NOT_FOUND',
                  'This item version is unavailable or was not recorded',
                );
              const summary = summarize(row, context);
              const archived_at =
                row.archived_at === null ? null : timestamp(row.archived_at, context);
              const item = row.item_document;
              if (
                !item ||
                typeof item !== 'object' ||
                Array.isArray(item) ||
                item.id !== id ||
                item.version !== summary.version ||
                item.title !== summary.title ||
                item.tenant_id !== context.tenant_id ||
                item.workspace_id !== context.workspace_id ||
                item.project_id !== context.project_id ||
                item.classification !== summary.classification ||
                item.status !== summary.status ||
                !Array.isArray(item.source_refs) ||
                fingerprint({ item, archived_at }) !== row.snapshot_hash
              )
                throw fail(context, 'CONTEXT_ITEM_INVALID', 'Stored history snapshot is invalid');
              try {
                item.source_refs.forEach(validateSourceRef);
              } catch {
                throw fail(context, 'CONTEXT_ITEM_INVALID', 'Stored history sources are invalid');
              }
              const data: ContextItemRevision = {
                ...summary,
                item,
                archived_at,
                confirmation: confirmation(row, context),
              };
              return {
                ...envelope(context, id, data),
                source_refs: [
                  { type: 'context-item', id, revision: summary.version },
                  ...item.source_refs,
                ],
              };
            }
            const rows = await db<
              HistoryRow[]
            >`SELECT item_id, item_version, operation, title, classification, status,
              archived_at, snapshot_hash, actor_id, client_id, event_id, recorded_at, confirmation_reason FROM wcp_context_item_history
            WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id}
              AND project_id = ${context.project_id} AND item_id = ${id} AND item_version <= ${currentVersion}
              AND (${before}::bigint IS NULL OR item_version < ${before}) AND (${restricted} OR classification <> 'restricted')
            ORDER BY item_version DESC LIMIT ${limit + 1}`;
            const versions = rows.slice(0, limit).map((row) => summarize(row, context));
            const data: ContextItemHistoryPage = {
              item_id: id,
              current_version: currentVersion,
              current_archived: current.deleted_at !== null,
              versions,
              ...(rows.length > limit
                ? { next_before_version: versions[versions.length - 1]!.version }
                : {}),
            };
            return envelope(context, id, data);
          });
        } catch (error) {
          if (error instanceof ContractError) throw error;
          throw new ContractError(
            'CONTEXT_ITEM_STORAGE_UNAVAILABLE',
            'Context item history storage is unavailable',
            { trace_id: context.trace_id, retryable: true },
          );
        }
      },
    );
  }
}

function summarize(row: HistoryRow, context: RequestContext): ContextItemRevisionSummary {
  if (
    !['baseline', 'create', 'update', 'archive', 'restore', 'confirm'].includes(row.operation) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(row.classification) ||
    !['confirmed', 'proposed', 'expired', 'excluded'].includes(row.status) ||
    typeof row.title !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row.snapshot_hash) ||
    (row.operation === 'baseline'
      ? row.actor_id !== null || row.client_id !== null || row.event_id !== null
      : typeof row.actor_id !== 'string' ||
        !row.actor_id ||
        typeof row.client_id !== 'string' ||
        !row.client_id ||
        !isUlid(row.event_id))
  )
    throw fail(context, 'CONTEXT_ITEM_INVALID', 'Stored history metadata is invalid');
  confirmation(row, context);
  return {
    version: storedPositive(row.item_version, context),
    operation: row.operation,
    title: row.title,
    classification: row.classification,
    status: row.status,
    archived: row.archived_at !== null,
    recorded_at: timestamp(row.recorded_at, context),
    actor_id: row.actor_id,
    client_id: row.client_id,
    event_id: row.event_id,
    snapshot_hash: row.snapshot_hash,
  };
}

/** Caller has already checked current item visibility in the same read transaction. */
export async function readContextConfirmation(
  db: RuntimeSql,
  context: RequestContext,
  item: ContextItemDocument,
): Promise<ContextItemConfirmation | null> {
  if (item.status !== 'confirmed') return null;
  const [row] = await db<HistoryRow[]>`SELECT * FROM wcp_context_item_history
    WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id}
      AND project_id = ${context.project_id} AND item_id = ${item.id} AND item_version = ${item.version}`;
  if (!row) return null; // Legacy confirmed records have no invented approval metadata.
  summarize(row, context);
  if (
    row.operation === 'confirm' &&
    (row.classification !== item.classification ||
      row.snapshot_hash !== fingerprint({ item, archived_at: null }))
  )
    throw fail(
      context,
      'CONTEXT_ITEM_INVALID',
      'Current content does not match its confirmation snapshot',
    );
  return confirmation(row, context);
}

function confirmation(row: HistoryRow, context: RequestContext): ContextItemConfirmation | null {
  if (row.operation !== 'confirm') {
    if (row.confirmation_reason !== null)
      throw fail(context, 'CONTEXT_ITEM_INVALID', 'Unexpected confirmation metadata');
    return null;
  }
  const version = storedPositive(row.item_version, context);
  if (
    version < 2 ||
    row.status !== 'confirmed' ||
    row.archived_at !== null ||
    !row.actor_id ||
    !row.client_id ||
    !isUlid(row.event_id)
  )
    throw fail(context, 'CONTEXT_ITEM_INVALID', 'Stored confirmation metadata is invalid');
  let reason: string;
  try {
    reason = parseConfirmContextItem({ reason: row.confirmation_reason }).reason;
  } catch {
    throw fail(context, 'CONTEXT_ITEM_INVALID', 'Stored confirmation reason is invalid');
  }
  return {
    reviewed_version: version - 1,
    confirmed_version: version,
    actor_id: row.actor_id,
    client_id: row.client_id,
    event_id: row.event_id,
    reason,
    confirmed_at: timestamp(row.recorded_at, context),
  };
}
function positive(value: unknown, context: RequestContext, name: string): number {
  // Path parameters are strings; only canonical positive decimal integers are accepted.
  const number = typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value) ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1)
    throw fail(context, 'INVALID_INPUT', name + ' must be a positive safe integer');
  return number;
}
function storedPositive(value: number | string, context: RequestContext): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw fail(context, 'CONTEXT_ITEM_INVALID', 'Stored history version is invalid');
  return number;
}
function timestamp(value: string | Date, context: RequestContext): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw fail(context, 'CONTEXT_ITEM_INVALID', 'Stored history timestamp is invalid');
  return date.toISOString();
}
function envelope<T>(context: RequestContext, id: string, data: T) {
  return {
    schema_version: 1 as const,
    trace_id: context.trace_id,
    data,
    source_refs: [{ type: 'context-item', id }],
  };
}
function fail(context: RequestContext, code: string, message: string) {
  return new ContractError(code, message, { trace_id: context.trace_id });
}
