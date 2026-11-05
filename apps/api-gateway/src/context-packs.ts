import {
  ContractError,
  createUlid,
  isUlid,
  validateIdempotencyKey,
  validateSourceRef,
  type Classification,
  type ContextItem,
  type ContextPack,
  type ContextPackReceipt,
  type ContextScope,
} from '@planemem/contracts';
import {
  compileContextPack,
  estimateContextTokens,
  hashContextPack,
  renderMarkdown,
  validateContextItem,
} from '@planemem/context-compiler';
import type { CanonicalEvent } from '@planemem/events';
import type { RuntimeSql } from './runtime-persistence.js';
import type { CommandRequest, CommandRouter, RequestContext } from './router.js';
import { commandReceipt } from './http.js';
import { fingerprint } from './idempotency.js';
import { appendSyncEvent, highWater, lockSyncStream } from './sync-stream.js';
import { inspectContextSourceGraph, inspectContextSources } from './context-sources.js';
import { saveContextPackDependencies } from './context-pack-invalidation.js';

interface SourceRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  item_type: string;
  layer: ContextItem['layer'];
  classification: Classification;
  status: string;
  source_ref: string;
  expires_at: string | Date | null;
  confidence: number | string;
  priority: 'High' | 'Medium' | 'Low';
  content: unknown;
  source_refs: unknown[];
  version: number | string;
  trace_id: string;
  updated_at: string | Date;
}

interface PackRow {
  pack_id: string;
  version: string | number;
  created_at: Date | string;
  expires_at: Date | string;
  pack_hash: string;
  budget_tokens: number;
  used_tokens: number;
  pack_document: ContextPack;
  source_manifest: Array<{ id: string; hash: string; dependency_hash?: string }>;
  read_restricted: boolean;
  request_fingerprint: string;
  server_cursor: number | string;
}

const allowed: Classification[] = ['public', 'internal', 'confidential'];

export function registerContextPacks(router: CommandRouter, database: RuntimeSql | undefined) {
  router.register('context.pack.compile', (request) =>
    withDatabase(database, request, async (db) => {
      if (
        Object.keys(request.input).some(
          (key) => !['budget_tokens', 'ttl_seconds', 'idempotency_key'].includes(key),
        )
      )
        throw failure(
          request.context,
          'INVALID_INPUT',
          'Only budget_tokens, ttl_seconds and idempotency_key are accepted',
        );
      if (request.context.authenticated_client !== true)
        throw failure(
          request.context,
          'DENIED',
          'An authenticated client is required to compile a pack',
        );
      const budget = integer(
        request.input.budget_tokens === undefined ? 4096 : request.input.budget_tokens,
        128,
        32768,
        'budget_tokens',
        request.context,
      );
      const ttl = integer(
        request.input.ttl_seconds === undefined ? 3600 : request.input.ttl_seconds,
        60,
        86400,
        'ttl_seconds',
        request.context,
      );
      let key: string;
      try {
        key = validateIdempotencyKey(
          request.context.idempotency_key ?? request.input.idempotency_key,
        );
      } catch {
        throw failure(request.context, 'INVALID_INPUT', 'A stable idempotency key is required');
      }
      if (
        request.context.idempotency_key !== undefined &&
        request.input.idempotency_key !== undefined &&
        request.context.idempotency_key !== request.input.idempotency_key
      )
        throw failure(request.context, 'INVALID_INPUT', 'Idempotency keys disagree');
      const context = request.context;
      const restricted = context.capability.includes('data.restricted.read');
      const receipt = commandReceipt(
        { ...request, input: { budget_tokens: budget, ttl_seconds: ttl } },
        key,
      );
      const requestHash = fingerprint([receipt.fingerprint, restricted]);
      return db.begin(async (tx) => {
        await lockSyncStream(tx, context);
        await requireReadableProject(tx, context, true);
        const [previous] = await tx<PackRow[]>`SELECT * FROM wcp_context_packs
        WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id}
          AND project_id = ${context.project_id} AND request_key = ${receipt.key}`;
        if (previous) {
          if (previous.request_fingerprint !== requestHash)
            throw failure(
              context,
              'IDEMPOTENCY_KEY_REUSED',
              'This key belongs to another pack request or visibility scope',
            );
          const document = await checkedDocument(tx, previous, context);
          return result(context, document, Number(previous.server_cursor));
        }
        const rows = await tx<SourceRow[]>`SELECT * FROM wcp_context_items
        WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id} AND project_id = ${context.project_id}
          AND deleted_at IS NULL AND status IN ('confirmed', 'proposed', 'expired')
          AND (${restricted} OR classification <> 'restricted')
        ORDER BY id LIMIT 1001 FOR SHARE`;
        if (rows.length > 1000)
          throw failure(
            context,
            'CONTEXT_SOURCE_LIMIT',
            'This project exceeds the current 1000-item pack input limit',
          );
        const sourceGraph = await inspectContextSourceGraph(
          tx,
          context,
          rows.map((row) => row.id),
          { lock: true },
        );
        const sourceChecks = sourceGraph.checks;
        if ([...sourceChecks.values()].some((check) => check.check.state === 'limit'))
          throw failure(
            context,
            'CONTEXT_SOURCE_LIMIT',
            'The source graph exceeds the bounded inspection limits',
          );
        const now = new Date().toISOString();
        const scope = contextScope(context);
        const pack = compileContextPack(
          {
            scope,
            trace_id: context.trace_id,
            items: rows.map((row) => {
              const item = itemFromRow(row, scope, now);
              const check = sourceChecks.get(row.id)!;
              if (check.current && check.expires_at !== null) item.expires_at = check.expires_at;
              return item;
            }),
          },
          {
            budget_tokens: budget,
            strict_budget: true,
            unavailable_source_ids: new Set(
              rows.filter((row) => !sourceChecks.get(row.id)!.current).map((row) => row.id),
            ),
            policy: {
              allowed_classifications: restricted ? [...allowed, 'restricted'] : allowed,
              now,
            },
            expires_at: new Date(Date.parse(now) + ttl * 1000).toISOString(),
          },
        );
        const [latest] = await tx<
          { version: string | number }[]
        >`SELECT COALESCE(MAX(version), 0) AS version FROM wcp_context_packs
        WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id} AND project_id = ${context.project_id}`;
        const version = Number(latest!.version) + 1;
        if (!Number.isSafeInteger(version))
          throw failure(
            context,
            'CONTEXT_PACK_INVALID',
            'Pack version exceeds the supported range',
          );
        const packId = createUlid();
        const used = pack.items.reduce((sum, item) => sum + estimateContextTokens(item), 0);
        const cursor = (await highWater(tx, context)) + 1;
        await tx`UPDATE wcp_context_packs SET status = 'superseded'
        WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id} AND project_id = ${context.project_id}
          AND read_restricted = ${restricted} AND status = 'latest' AND pack_document IS NOT NULL`;
        await tx`INSERT INTO wcp_context_packs
        (pack_id, tenant_id, workspace_id, project_id, version, pack_hash, budget_tokens, used_tokens, scope, status,
          source_refs, trace_id, expires_at, created_at, pack_document, source_manifest, read_restricted, request_key, request_fingerprint, server_cursor)
        VALUES (${packId}, ${scope.tenant_id}, ${scope.workspace_id}, ${scope.project_id}, ${version}, ${pack.pack_hash},
          ${budget}, ${used}, ${JSON.stringify(scope)}::jsonb, 'latest', ${JSON.stringify(pack.source_refs)}::jsonb,
          ${context.trace_id}, ${pack.expires_at}, ${now}, ${JSON.stringify(pack)}::jsonb,
          ${JSON.stringify(rows.map((row) => ({ id: row.id, hash: sourceHash(row), dependency_hash: sourceChecks.get(row.id)!.hash })))}::jsonb,
          ${restricted}, ${receipt.key}, ${requestHash}, ${cursor})`;
        // Include excluded direct inputs too: the immutable manifest covers all compiler inputs.
        const dependencies = new Map(sourceGraph.revisions);
        for (const row of rows) dependencies.set(row.id, Number(row.version));
        await saveContextPackDependencies(tx, scope, packId, dependencies);
        const event: CanonicalEvent = {
          schema_version: 1,
          event_id: createUlid(),
          event_type: 'ContextPackIssued',
          ...scope,
          aggregate_type: 'ContextPack',
          aggregate_id: packId,
          aggregate_version: version,
          ...(isUlid(context.actor_id) ? { actor_id: context.actor_id } : {}),
          client_id: context.client_id,
          occurred_at: now,
          trace_id: context.trace_id,
          sensitivity: restricted ? 'restricted' : 'internal',
          source_refs: [{ type: 'context-pack', id: packId }],
          payload: {
            pack_id: packId,
            pack_hash: pack.pack_hash,
            version,
            budget_tokens: budget,
            used_tokens: used,
          },
        };
        await appendSyncEvent(tx, event, cursor);
        return result(
          context,
          { pack_id: packId, version, created_at: now, used_tokens: used, pack },
          cursor,
        );
      });
    }),
  );

  router.register('context.pack.read', (request) =>
    withDatabase(database, request, async (db) => {
      const { input, context } = request;
      if (Object.keys(input).some((key) => !['pack_id', 'format'].includes(key)))
        throw failure(context, 'INVALID_INPUT', 'Only pack_id and format are accepted');
      if (input.pack_id !== undefined && !isUlid(input.pack_id))
        throw failure(context, 'INVALID_INPUT', 'pack_id must be a ULID');
      const format = input.format === undefined ? 'json' : input.format;
      if (typeof format !== 'string' || !['json', 'markdown', 'mcp'].includes(format))
        throw failure(context, 'INVALID_INPUT', 'format must be json, markdown or mcp');
      return db.begin('isolation level repeatable read read only', async (tx) => {
        await requireReadableProject(tx, context);
        const restricted = context.capability.includes('data.restricted.read');
        const [row] = await tx<PackRow[]>`SELECT * FROM wcp_context_packs
        WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id} AND project_id = ${context.project_id}
          AND pack_document IS NOT NULL AND (${restricted} OR NOT read_restricted)
          AND (${input.pack_id === undefined ? null : String(input.pack_id)}::text IS NULL OR pack_id = ${input.pack_id === undefined ? null : String(input.pack_id)})
        ORDER BY version DESC, pack_id DESC LIMIT 1`;
        if (!row)
          throw failure(
            context,
            'CONTEXT_PACK_NOT_FOUND',
            'No saved context pack is available in this project',
          );
        const document = await checkedDocument(tx, row, context);
        if (format !== 'json')
          document.rendered = {
            uri: packUri(context.project_id, document.pack_id),
            mimeType: 'text/markdown',
            text: renderMarkdown(document.pack),
          };
        return result(context, document, Number(row.server_cursor));
      });
    }),
  );
}

export function packUri(projectId: string, packId: string) {
  return (
    'work://project/' +
    encodeURIComponent(projectId) +
    '/context-pack/' +
    encodeURIComponent(packId)
  );
}

/** Keep source mutations behind the project lock until the consuming write finishes. */
export async function withSavedContextPack<T>(
  router: CommandRouter,
  database: RuntimeSql | undefined,
  context: RequestContext,
  packId: unknown,
  consume: (document: ContextPackReceipt, transaction: RuntimeSql) => Promise<T>,
): Promise<T> {
  if (!isUlid(packId)) throw failure(context, 'INVALID_INPUT', 'context_pack_id must be a ULID');
  const request = { operation: 'context.pack.read', input: { pack_id: packId }, context };
  await router.authorize(request);
  return withDatabase<T>(
    database,
    request,
    async (db) =>
      (await db.begin(async (tx) => {
        await lockSyncStream(tx, context);
        await requireReadableProject(tx, context, true);
        const restricted = context.capability.includes('data.restricted.read');
        const [row] = await tx<PackRow[]>`SELECT * FROM wcp_context_packs
        WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id}
          AND project_id = ${context.project_id} AND pack_id = ${packId}
          AND pack_document IS NOT NULL AND (${restricted} OR NOT read_restricted)`;
        if (!row) throw failure(context, 'CONTEXT_PACK_NOT_FOUND', 'Context pack is unavailable');
        return consume(await checkedDocument(tx, row, context), tx);
      })) as T,
  );
}

async function requireReadableProject(db: RuntimeSql, context: RequestContext, lock = false) {
  const [project] = await db`SELECT id FROM wcp_projects
    WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id}
      AND id = ${context.project_id} AND deleted_at IS NULL
      AND (${context.capability.includes('data.restricted.read')} OR classification <> 'restricted')
    ${db.unsafe(lock ? 'FOR SHARE' : '')}`;
  if (!project)
    throw failure(context, 'CONTEXT_PACK_NOT_FOUND', 'Context pack project is unavailable');
}

async function checkedDocument(
  tx: RuntimeSql,
  row: PackRow,
  context: RequestContext,
): Promise<ContextPackReceipt> {
  if (row.read_restricted && !context.capability.includes('data.restricted.read'))
    throw failure(context, 'CONTEXT_PACK_NOT_FOUND', 'Context pack is unavailable');
  const pack = row.pack_document;
  if (
    !pack ||
    pack.schema_version !== 1 ||
    pack.pack_version !== 1 ||
    !pack.scope ||
    pack.scope.tenant_id !== context.tenant_id ||
    pack.scope.workspace_id !== context.workspace_id ||
    pack.scope.project_id !== context.project_id ||
    !Array.isArray(pack.items) ||
    !Array.isArray(pack.exclusions) ||
    !Array.isArray(pack.source_refs) ||
    pack.pack_hash !== row.pack_hash ||
    hashContextPack(pack) !== row.pack_hash ||
    pack.budget_tokens !== row.budget_tokens ||
    !isUlid(row.pack_id) ||
    !Array.isArray(row.source_manifest) ||
    typeof row.read_restricted !== 'boolean' ||
    !Number.isSafeInteger(pack.budget_tokens) ||
    pack.budget_tokens < 128 ||
    pack.budget_tokens > 32768 ||
    !Number.isSafeInteger(row.used_tokens) ||
    row.used_tokens < 0 ||
    !Number.isSafeInteger(Number(row.version)) ||
    Number(row.version) < 1 ||
    !Number.isSafeInteger(Number(row.server_cursor)) ||
    Number(row.server_cursor) < 1
  )
    throw failure(context, 'CONTEXT_PACK_INVALID', 'Stored context pack is invalid');
  try {
    for (const item of pack.items) {
      validateContextItem(item);
      if (
        item.tenant_id !== context.tenant_id ||
        item.workspace_id !== context.workspace_id ||
        item.project_id !== context.project_id ||
        (!row.read_restricted && item.sensitivity === 'restricted') ||
        item.selection_reason !== 'ranked-fit' ||
        (item.expires_at !== undefined && Date.parse(item.expires_at) < Date.parse(pack.expires_at))
      )
        throw new TypeError('Invalid selected item');
    }
    pack.source_refs.forEach(validateSourceRef);
    if (
      pack.exclusions.some(
        (item) =>
          !item ||
          typeof item.id !== 'string' ||
          !item.id ||
          !['policy', 'expired', 'budget', 'source'].includes(item.reason),
      )
    )
      throw new TypeError('Invalid exclusion');
    if (
      typeof pack.expires_at !== 'string' ||
      !Number.isFinite(Date.parse(pack.expires_at)) ||
      Date.parse(iso(row.created_at)) >= Date.parse(pack.expires_at)
    )
      throw new TypeError('Invalid lifetime');
  } catch {
    throw failure(context, 'CONTEXT_PACK_INVALID', 'Stored context pack content is invalid');
  }
  if (iso(row.expires_at) !== pack.expires_at)
    throw failure(context, 'CONTEXT_PACK_INVALID', 'Stored expiry is inconsistent');
  if (Date.parse(pack.expires_at) <= Date.now())
    throw failure(
      context,
      'CONTEXT_PACK_EXPIRED',
      'This context pack expired. Compile a new pack.',
    );
  const invalidated = await tx`SELECT pack_id FROM wcp_context_pack_invalidations
    WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id}
      AND project_id = ${context.project_id} AND pack_id = ${row.pack_id}`;
  if (invalidated.length)
    throw failure(context, 'CONTEXT_PACK_STALE', 'Context sources changed. Compile a new pack.');
  const ids = [...pack.items.map((item) => item.id), ...pack.exclusions.map((item) => item.id)];
  const manifestIds = new Set(row.source_manifest.map((source) => source?.id));
  if (
    manifestIds.size !== row.source_manifest.length ||
    new Set(ids).size !== ids.length ||
    ids.length !== manifestIds.size ||
    ids.some((id) => !manifestIds.has(id)) ||
    row.source_manifest.some(
      (source) =>
        !source ||
        typeof source.id !== 'string' ||
        typeof source.hash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(source.hash) ||
        (source.dependency_hash !== undefined &&
          (typeof source.dependency_hash !== 'string' ||
            !/^[a-f0-9]{64}$/.test(source.dependency_hash))),
    )
  )
    throw failure(context, 'CONTEXT_PACK_INVALID', 'Stored source manifest is incomplete');
  const rows = await tx<SourceRow[]>`SELECT c.* FROM wcp_context_items c
    WHERE c.tenant_id = ${context.tenant_id} AND c.workspace_id = ${context.workspace_id} AND c.project_id = ${context.project_id}
      AND c.deleted_at IS NULL AND c.id IN (SELECT entry->>'id' FROM jsonb_array_elements(${JSON.stringify(row.source_manifest)}::jsonb) AS entry)`;
  const current = new Map(rows.map((source) => [source.id, sourceHash(source)]));
  if (
    row.source_manifest.some(
      (source) =>
        !source || typeof source.id !== 'string' || current.get(source.id) !== source.hash,
    )
  )
    throw failure(
      context,
      'CONTEXT_PACK_STALE',
      'Context sources changed or became unavailable. Compile a new pack.',
    );
  const sourceChecks = await inspectContextSources(
    tx,
    context,
    row.source_manifest.map((source) => source.id),
  );
  if (
    row.source_manifest.some(
      (source) =>
        !source.dependency_hash ||
        sourceChecks.get(source.id)?.check.state === 'limit' ||
        sourceChecks.get(source.id)?.hash !== source.dependency_hash,
    ) ||
    pack.items.some((item) => !sourceChecks.get(item.id)?.current)
  )
    throw failure(
      context,
      'CONTEXT_PACK_STALE',
      'The saved source chain changed or has no dependency snapshot. Compile a new pack.',
    );
  const used = pack.items.reduce((sum, item) => sum + estimateContextTokens(item), 0);
  if (used !== row.used_tokens || used > pack.budget_tokens)
    throw failure(context, 'CONTEXT_PACK_INVALID', 'Stored budget is inconsistent');
  return {
    pack_id: row.pack_id,
    version: Number(row.version),
    created_at: iso(row.created_at),
    used_tokens: used,
    pack,
  };
}

function sourceHash(row: SourceRow) {
  return fingerprint({
    id: row.id,
    tenant_id: row.tenant_id,
    workspace_id: row.workspace_id,
    project_id: row.project_id,
    title: row.title,
    item_type: row.item_type,
    layer: row.layer,
    classification: row.classification,
    status: row.status,
    source_ref: row.source_ref,
    expires_at: row.expires_at === null ? null : iso(row.expires_at),
    confidence: Number(row.confidence),
    priority: row.priority,
    content: row.content,
    source_refs: row.source_refs,
    version: Number(row.version),
    trace_id: row.trace_id,
    updated_at: iso(row.updated_at),
  });
}

function itemFromRow(row: SourceRow, scope: ContextScope, now: string): ContextItem {
  const revision = Number(row.version);
  const confidence = Number(row.confidence);
  if (
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1 ||
    !Array.isArray(row.source_refs) ||
    !['High', 'Medium', 'Low'].includes(row.priority)
  )
    throw new ContractError('CONTEXT_PACK_INVALID', 'A context source contains invalid metadata');
  const expires =
    row.status === 'expired' ? now : row.expires_at === null ? undefined : iso(row.expires_at);
  const item: ContextItem = {
    schema_version: 1,
    ...scope,
    id: row.id,
    layer: row.layer,
    content:
      '# ' +
      row.title +
      '\n\n' +
      (typeof row.content === 'string' ? row.content : JSON.stringify(row.content)),
    source_refs: [{ type: 'context-item', id: row.id, revision }, ...sourceRefs(row.source_refs)],
    confirmed: row.status === 'confirmed',
    confidence,
    priority: { High: 90, Medium: 50, Low: 10 }[row.priority],
    sensitivity: row.classification,
    trace_id: row.trace_id,
    revision,
    ...(expires === undefined ? {} : { expires_at: expires }),
  };
  try {
    validateContextItem(item);
  } catch {
    throw new ContractError('CONTEXT_PACK_INVALID', 'A context source contains invalid content');
  }
  return item;
}

function result(context: RequestContext, document: ContextPackReceipt, cursor: number) {
  return {
    schema_version: 1 as const,
    data: document,
    trace_id: context.trace_id,
    revision: document.version,
    etag: `W/"version-${document.version}"`,
    server_cursor: cursor,
    source_refs: [{ type: 'context-pack', id: document.pack_id }, ...document.pack.source_refs],
  };
}
function contextScope(context: RequestContext): ContextScope {
  if (![context.tenant_id, context.workspace_id, context.project_id].every(isUlid))
    throw failure(context, 'INVALID_INPUT', 'Context scope must contain ULIDs');
  return {
    tenant_id: context.tenant_id as ContextScope['tenant_id'],
    workspace_id: context.workspace_id as ContextScope['workspace_id'],
    project_id: context.project_id as ContextScope['project_id'],
  };
}
function integer(
  value: unknown,
  min: number,
  max: number,
  field: string,
  context: RequestContext,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw failure(
      context,
      'INVALID_INPUT',
      `${field} must be an integer between ${min} and ${max}`,
    );
  return value;
}
function iso(value: string | Date) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new ContractError('CONTEXT_PACK_INVALID', 'Stored context timestamp is invalid');
  return date.toISOString();
}
function sourceRefs(values: unknown[]) {
  try {
    return values.map(validateSourceRef);
  } catch {
    throw new ContractError('CONTEXT_PACK_INVALID', 'Stored context source references are invalid');
  }
}
function failure(context: RequestContext, code: string, message: string) {
  return new ContractError(code, message, { trace_id: context.trace_id });
}
async function withDatabase<T>(
  db: RuntimeSql | undefined,
  request: CommandRequest,
  run: (db: RuntimeSql) => Promise<T>,
): Promise<T> {
  try {
    if (db) return await run(db);
  } catch (error) {
    if (error instanceof ContractError) throw error;
  }
  throw new ContractError(
    'CONTEXT_PACK_STORAGE_UNAVAILABLE',
    'Context pack storage is unavailable',
    { trace_id: request.context.trace_id, retryable: true },
  );
}
