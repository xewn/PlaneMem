import {
  ContractError,
  buildEtag,
  createUlid,
  isSyncIdentifier,
  isUlid,
  parseCreateContextItem,
  parseUpdateContextItem,
  parseConfirmContextItem,
  validateIdempotencyKey,
  validateSourceRef,
  type Classification,
  type ContextItemDocument,
  type ContextItemMutationReceipt,
  type ContextScope,
  type CreateContextItemRequest,
  type UpdateContextItemRequest,
} from '@planemem/contracts';
import type { CanonicalEvent } from '@planemem/events';
import { commandReceipt } from './http.js';
import { fingerprint } from './idempotency.js';
import type { CommandRequest, CommandRouter, RequestContext } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';
import { appendSyncEvent, highWater, lockSyncStream } from './sync-stream.js';
import { inspectContextSources } from './context-sources.js';
import {
  readContextConfirmation,
  recordContextRevision,
  registerContextItemHistory,
} from './context-item-history.js';

type ItemRow = Omit<
  ContextItemDocument,
  'version' | 'confidence' | 'expires_at' | 'created_at' | 'updated_at'
> & {
  version: string | number;
  confidence: string | number;
  expires_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
};
interface CommandRow {
  fingerprint: string;
  item_id: string;
  operation: ContextItemMutationReceipt['operation'];
  item_version: string | number;
  classification: Classification;
  event_id: string;
  server_cursor: string | number;
  occurred_at: string | Date;
}

export function registerContextItems(router: CommandRouter, database: RuntimeSql | undefined) {
  registerContextItemHistory(router, database);
  for (const archived of [false, true]) {
    router.register(archived ? 'context.item.archived.read' : 'context.item.read', (request) =>
      stored(database, request.context, (database) =>
        database.begin('isolation level repeatable read read only', async (db) => {
          const id = itemId(request.input.item_id, request.context);
          if (Object.keys(request.input).some((key) => key !== 'item_id'))
            throw fail(request.context, 'INVALID_INPUT', 'Only item_id is accepted');
          const row = await findItem(db, request.context, id, archived, false);
          if (archived && row.deleted_at === null)
            throw fail(
              request.context,
              'CONTEXT_ITEM_NOT_FOUND',
              'Archived context item is unavailable',
            );
          const item = document(row, request.context);
          const canReview =
            !archived && mayConfirmContext(request.context) && item.status === 'proposed';
          const inspection = archived
            ? undefined
            : (
                await inspectContextSources(db, request.context, [item.id], {
                  reference_checks: true,
                  confirmation_check: canReview,
                })
              ).get(item.id)!;
          return {
            schema_version: 1 as const,
            trace_id: request.context.trace_id,
            data: archived
              ? { ...item, archived_at: archiveTimestamp(row, request.context) }
              : {
                  ...item,
                  confirmation: await readContextConfirmation(db, request.context, item),
                  sources_current: inspection!.current,
                  source_check: inspection!.check,
                  source_checks: inspection!.reference_checks,
                  ...(inspection!.confirmation_readiness === undefined
                    ? {}
                    : {
                        confirmation_readiness: inspection!.confirmation_readiness,
                      }),
                  confirm_allowed:
                    canReview &&
                    inspection!.confirmation_readiness?.sources_current === true &&
                    (inspection!.confirmation_readiness.effective_expires_at === null ||
                      Date.parse(inspection!.confirmation_readiness.effective_expires_at) >
                        Date.now()),
                },
            revision: item.version,
            etag: buildEtag(item.version),
            source_refs: [
              { type: 'context-item', id: item.id, revision: item.version },
              ...item.source_refs,
            ],
          };
        }),
      ),
    );
  }
  for (const operation of ['create', 'update', 'archive', 'restore', 'confirm'] as const) {
    router.register('context.item.' + operation, (request) =>
      stored(database, request.context, async (db) => {
        const context = request.context;
        if (context.authenticated_client !== true)
          throw fail(context, 'DENIED', 'An authenticated client is required');
        if (operation === 'confirm' && !mayConfirmContext(context))
          throw fail(
            context,
            'DENIED',
            'Confirmation requires a human token and context.review permission',
          );
        const scope = itemScope(context);
        const raw = { ...request.input };
        const id = operation === 'create' ? undefined : itemId(raw.item_id, context);
        if (operation !== 'create') delete raw.item_id;
        const expected = operation === 'create' ? undefined : expectedVersion(request);
        if (operation !== 'create') delete raw.expected_version;
        const key = requestKey(request);
        delete raw.idempotency_key;
        let create: Required<CreateContextItemRequest> | undefined;
        let update: UpdateContextItemRequest | undefined;
        let confirmation: { reason: string } | undefined;
        try {
          if (operation === 'create') create = parseCreateContextItem(raw);
          else if (operation === 'update') update = parseUpdateContextItem(raw);
          else if (operation === 'confirm') confirmation = parseConfirmContextItem(raw);
          else if (Object.keys(raw).length)
            throw new TypeError(
              'Archive and restore accept only item_id, expected_version and idempotency_key',
            );
        } catch (error) {
          throw fail(
            context,
            'INVALID_INPUT',
            error instanceof Error ? error.message : 'Invalid context item',
          );
        }
        if (
          create?.classification === 'restricted' &&
          !context.capability.includes('data.restricted.read')
        )
          throw fail(context, 'DENIED', 'Restricted context requires data.restricted.read');
        const receipt = commandReceipt(request, key);
        const requestHash = fingerprint([
          operation,
          id,
          expected,
          create ?? update ?? confirmation ?? {},
        ]);
        return db.begin(async (tx) => {
          // ContextPack compilation uses the same ordering: stream lock, then source row locks.
          await lockSyncStream(tx, context);
          const [previous] = await tx<CommandRow[]>`SELECT * FROM wcp_context_item_commands
          WHERE tenant_id = ${scope.tenant_id} AND workspace_id = ${scope.workspace_id}
            AND project_id = ${scope.project_id} AND request_key = ${receipt.key}`;
          if (previous) {
            if (previous.fingerprint !== requestHash)
              throw fail(
                context,
                'IDEMPOTENCY_KEY_REUSED',
                'This request key belongs to another context item command',
              );
            if (
              previous.classification === 'restricted' &&
              !context.capability.includes('data.restricted.read')
            )
              throw fail(context, 'CONTEXT_ITEM_NOT_FOUND', 'Context item is unavailable');
            await findItem(tx, context, previous.item_id, true, true);
            return mutationResult(previous, context, true);
          }
          const now = new Date().toISOString();
          let item: ItemRow;
          if (create) {
            const newId = createUlid();
            const source = sourceLabel(create.source_refs);
            const [inserted] = await tx<ItemRow[]>`INSERT INTO wcp_context_items
            (id, tenant_id, workspace_id, project_id, title, item_type, layer, classification, status,
              source_ref, expires_at, confidence, priority, content, source_refs, version, trace_id, created_at, updated_at)
            VALUES (${newId}, ${scope.tenant_id}, ${scope.workspace_id}, ${scope.project_id}, ${create.title},
              ${create.item_type}, ${create.layer}, ${create.classification}, 'proposed', ${source}, ${create.expires_at},
              ${create.confidence}, ${create.priority}, ${JSON.stringify(create.content)}::jsonb,
              ${JSON.stringify(create.source_refs)}::jsonb, 1, ${context.trace_id}, ${now}, ${now}) RETURNING *`;
            item = inserted!;
          } else {
            const current = await findItem(tx, context, id!, operation === 'restore', true);
            const version = safePositive(current.version, context);
            if (version !== expected)
              throw new ContractError(
                'CONTEXT_ITEM_VERSION_CONFLICT',
                'The context item changed. Refresh before editing again.',
                {
                  trace_id: context.trace_id,
                  expected_version: expected,
                  current_version: version,
                },
              );
            if (operation === 'restore' && current.deleted_at === null)
              throw fail(
                context,
                'CONTEXT_ITEM_NOT_ARCHIVED',
                'This context item is already active. Read its current version.',
              );
            if (operation === 'confirm') await confirmableSources(tx, context, current);
            const next = safePositive(version + 1, context);
            await recordContextRevision(
              tx,
              context,
              document(current, context),
              current.deleted_at === null ? null : archiveTimestamp(current, context),
            );
            const patch = update ?? {};
            const refs = patch.source_refs ?? current.source_refs;
            const status =
              operation === 'confirm'
                ? 'confirmed'
                : operation === 'archive' || operation === 'restore'
                  ? 'excluded'
                  : (patch.status ?? (current.status === 'excluded' ? 'excluded' : 'proposed'));
            const [changed] = await tx<ItemRow[]>`UPDATE wcp_context_items SET
            title = ${patch.title ?? current.title}, item_type = ${patch.item_type ?? current.item_type},
            layer = ${patch.layer ?? current.layer}, priority = ${patch.priority ?? current.priority},
            confidence = ${patch.confidence ?? Number(current.confidence)}, status = ${status},
            content = ${JSON.stringify(patch.content ?? current.content)}::jsonb,
            source_refs = ${JSON.stringify(refs)}::jsonb,
            source_ref = ${patch.source_refs === undefined ? current.source_ref : sourceLabel(refs)},
            expires_at = ${patch.expires_at === undefined ? current.expires_at : patch.expires_at},
            version = ${next}, trace_id = ${context.trace_id}, updated_at = ${now},
            deleted_at = ${operation === 'archive' ? now : null}
            WHERE id = ${current.id} AND tenant_id = ${scope.tenant_id} AND workspace_id = ${scope.workspace_id}
              AND project_id = ${scope.project_id} RETURNING *`;
            item = changed!;
          }
          const eventId = createUlid();
          const version = safePositive(item.version, context);
          const cursor = safePositive((await highWater(tx, context)) + 1, context);
          const event: CanonicalEvent = {
            schema_version: 1,
            event_id: eventId,
            event_type:
              operation === 'create'
                ? 'ContextItemCreated'
                : operation === 'update'
                  ? 'ContextItemUpdated'
                  : operation === 'archive'
                    ? 'ContextItemArchived'
                    : operation === 'restore'
                      ? 'ContextItemRestored'
                      : 'ContextItemConfirmed',
            ...scope,
            aggregate_type: 'ContextItem',
            aggregate_id: isUlid(item.id) ? item.id : eventId,
            aggregate_version: version,
            ...(isUlid(context.actor_id) ? { actor_id: context.actor_id } : {}),
            client_id: context.client_id,
            occurred_at: now,
            trace_id: context.trace_id,
            sensitivity: item.classification,
            source_refs: [{ type: 'context-item', id: item.id, revision: version }],
            payload: {
              item_id: item.id,
              version,
              status: item.status,
              archived: operation === 'archive',
            },
          };
          await appendSyncEvent(tx, event, cursor);
          await recordContextRevision(
            tx,
            context,
            document(item, context),
            item.deleted_at === null ? null : archiveTimestamp(item, context),
            {
              operation,
              event_id: eventId,
              ...(confirmation ? { confirmation_reason: confirmation.reason } : {}),
            },
          );
          await tx`INSERT INTO wcp_context_item_commands
          (tenant_id, workspace_id, project_id, request_key, fingerprint, item_id, operation, item_version,
            classification, event_id, server_cursor, occurred_at)
          VALUES (${scope.tenant_id}, ${scope.workspace_id}, ${scope.project_id}, ${receipt.key}, ${requestHash},
            ${item.id}, ${operation}, ${version}, ${item.classification}, ${eventId}, ${cursor}, ${now})`;
          return mutationResult(
            {
              fingerprint: requestHash,
              item_id: item.id,
              operation,
              item_version: version,
              classification: item.classification,
              event_id: eventId,
              server_cursor: cursor,
              occurred_at: now,
            },
            context,
            false,
          );
        });
      }),
    );
  }
}

function mayConfirmContext(context: RequestContext): boolean {
  return (
    context.actor_type === 'human' &&
    context.authenticated_client === true &&
    (context.capability.includes('context.review') || context.roles?.includes('admin') === true)
  );
}

/** Check the complete pinned local source chain at review time; external evidence is manual. */
async function confirmableSources(db: RuntimeSql, context: RequestContext, current: ItemRow) {
  if (current.status !== 'proposed')
    throw fail(
      context,
      'CONTEXT_ITEM_NOT_PROPOSED',
      'Only proposed items can be confirmed. Edit excluded or expired content first.',
    );
  const item = document(current, context);
  if (item.expires_at !== null && Date.parse(item.expires_at) <= Date.now())
    throw fail(context, 'CONTEXT_ITEM_EXPIRED', 'Expired content cannot be confirmed');
  if (!item.source_refs.length || item.source_refs.length > 32)
    throw fail(
      context,
      'CONTEXT_ITEM_SOURCE_UNAVAILABLE',
      'Confirmation requires between 1 and 32 sources',
    );
  const inspection = (
    await inspectContextSources(db, context, [item.id], {
      lock: true,
      require_confirmed: true,
    })
  ).get(item.id)!;
  if (item.expires_at !== null && Date.parse(item.expires_at) <= Date.now())
    throw fail(context, 'CONTEXT_ITEM_EXPIRED', 'The item expired during confirmation');
  if (inspection.expires_at !== null && Date.parse(inspection.expires_at) <= Date.now())
    throw fail(context, 'CONTEXT_ITEM_SOURCE_STALE', 'A local source expired during confirmation');
  if (!inspection.current)
    throw fail(
      context,
      ['unavailable', 'invalid'].includes(inspection.check.state)
        ? 'CONTEXT_ITEM_SOURCE_UNAVAILABLE'
        : 'CONTEXT_ITEM_SOURCE_STALE',
      'The local source chain is unavailable, stale, cyclic or exceeds the inspection limits',
    );
}

async function findItem(
  db: RuntimeSql,
  context: RequestContext,
  id: string,
  includeArchived: boolean,
  lock: boolean,
): Promise<ItemRow> {
  const restricted = context.capability.includes('data.restricted.read');
  const [row] = await db<ItemRow[]>`SELECT c.* FROM wcp_context_items c
    WHERE c.id = ${id} AND c.tenant_id = ${context.tenant_id} AND c.workspace_id = ${context.workspace_id} AND c.project_id = ${context.project_id}
      AND (${includeArchived} OR c.deleted_at IS NULL) AND (${restricted} OR c.classification <> 'restricted')
      AND EXISTS (SELECT 1 FROM wcp_projects p WHERE p.tenant_id = c.tenant_id AND p.workspace_id = c.workspace_id
        AND p.id = c.project_id AND p.deleted_at IS NULL AND (${restricted} OR p.classification <> 'restricted'))
    ${db.unsafe(lock ? 'FOR UPDATE' : '')}`;
  if (!row)
    throw fail(context, 'CONTEXT_ITEM_NOT_FOUND', 'Context item is unavailable in this project');
  return row;
}

function document(row: ItemRow, context: RequestContext): ContextItemDocument {
  const { deleted_at: _deleted, ...rest } = row;
  try {
    if (!Array.isArray(row.source_refs)) throw new TypeError('Invalid sources');
    const confidence = Number(row.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
      throw new TypeError('Invalid confidence');
    return {
      ...rest,
      version: safePositive(row.version, context),
      confidence,
      source_refs: row.source_refs.map(validateSourceRef),
      expires_at: row.expires_at === null ? null : new Date(row.expires_at).toISOString(),
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
    };
  } catch {
    throw fail(context, 'CONTEXT_ITEM_INVALID', 'Stored context item metadata is invalid');
  }
}
function archiveTimestamp(row: ItemRow, context: RequestContext): string {
  if (row.deleted_at === null || !Number.isFinite(new Date(row.deleted_at).getTime()))
    throw fail(context, 'CONTEXT_ITEM_INVALID', 'Stored archive timestamp is invalid');
  return new Date(row.deleted_at).toISOString();
}
function mutationResult(row: CommandRow, context: RequestContext, replayed: boolean) {
  if (
    !isSyncIdentifier(row.item_id) ||
    !isUlid(row.event_id) ||
    !['create', 'update', 'archive', 'restore', 'confirm'].includes(row.operation) ||
    !Number.isFinite(new Date(row.occurred_at).getTime())
  )
    throw fail(context, 'CONTEXT_ITEM_INVALID', 'Stored context command receipt is invalid');
  const version = safePositive(row.item_version, context);
  const data: ContextItemMutationReceipt = {
    item_id: row.item_id,
    operation: row.operation,
    version,
    event_id: row.event_id,
    occurred_at: new Date(row.occurred_at).toISOString(),
    replayed,
  };
  return {
    schema_version: 1 as const,
    trace_id: context.trace_id,
    data,
    revision: version,
    etag: buildEtag(version),
    server_cursor: safePositive(row.server_cursor, context),
    source_refs: [{ type: 'context-item', id: row.item_id, revision: version }],
  };
}
function sourceLabel(refs: CreateContextItemRequest['source_refs']) {
  const ref = refs[0]!;
  return ref.uri ?? ref.type + ':' + ref.id;
}
function itemId(value: unknown, context: RequestContext): string {
  if (!isSyncIdentifier(value) || value === '.' || value === '..')
    throw fail(context, 'INVALID_INPUT', 'Invalid item_id');
  return value;
}
function itemScope(context: RequestContext): ContextScope {
  const { tenant_id, workspace_id, project_id } = context;
  if (!isUlid(tenant_id) || !isUlid(workspace_id) || !isUlid(project_id))
    throw fail(context, 'INVALID_INPUT', 'Context scope must contain ULIDs');
  return { tenant_id, workspace_id, project_id };
}
function expectedVersion(request: CommandRequest): number {
  const { context, input } = request;
  const expected = context.expected_version ?? input.expected_version;
  if (
    typeof expected !== 'number' ||
    !Number.isSafeInteger(expected) ||
    expected < 1 ||
    (input.expected_version !== undefined &&
      context.expected_version !== undefined &&
      input.expected_version !== context.expected_version)
  )
    throw fail(context, 'INVALID_INPUT', 'Supply a matching positive expected_version or If-Match');
  return expected;
}
function requestKey(request: CommandRequest): string {
  const { context, input } = request;
  try {
    if (
      input.idempotency_key !== undefined &&
      context.idempotency_key !== undefined &&
      input.idempotency_key !== context.idempotency_key
    )
      throw new TypeError();
    return validateIdempotencyKey(context.idempotency_key ?? input.idempotency_key);
  } catch {
    throw fail(context, 'INVALID_INPUT', 'A stable, matching idempotency key is required');
  }
}
function safePositive(value: number | string, context: RequestContext): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw fail(context, 'CONTEXT_ITEM_INVALID', 'Stored context version or cursor is invalid');
  return number;
}
function fail(context: RequestContext, code: string, message: string) {
  return new ContractError(code, message, { trace_id: context.trace_id });
}
async function stored<T>(
  db: RuntimeSql | undefined,
  context: RequestContext,
  run: (db: RuntimeSql) => Promise<T>,
): Promise<T> {
  try {
    if (db) return await run(db);
  } catch (error) {
    if (error instanceof ContractError) throw error;
  }
  throw new ContractError(
    'CONTEXT_ITEM_STORAGE_UNAVAILABLE',
    'Context storage did not confirm the operation. Retry with the same request key.',
    { trace_id: context.trace_id, retryable: true },
  );
}
