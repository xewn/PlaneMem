import {
  ContractError,
  buildEtag,
  createUlid,
  isUlid,
  parseCreateProposal,
  parseProposalOrigin,
  parseProposalListQuery,
  proposalText,
  proposalWarnings,
  validateIdempotencyKey,
  validateSourceRef,
  type Classification,
  type ContextScope,
  type ProposalOrigin,
  type ProposalDocument,
  type ProposalSummary,
  type ProposalMutationReceipt,
  type SourceRef,
} from '@planemem/contracts';
import type { CanonicalEvent } from '@planemem/events';
import type { CommandRequest, CommandRouter, RequestContext } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';
import { commandReceipt } from './http.js';
import { fingerprint } from './idempotency.js';
import { appendSyncEvent, highWater, lockSyncStream } from './sync-stream.js';
import { inspectContextSources } from './context-sources.js';

type Manifest = Array<{ id: string; revision: number; hash: string; dependency_hash?: string }>;
type Row = Omit<
  ProposalDocument,
  'schema_version' | 'revision' | 'created_at' | 'expires_at' | 'reviewed_at'
> & {
  revision: string | number;
  created_at: string | Date;
  expires_at: string | Date;
  reviewed_at: string | Date | null;
  source_manifest: Manifest;
};
type Source = {
  id: string;
  version: string | number;
  classification: Classification;
  status: string;
  title: string;
  content: unknown;
  source_refs: SourceRef[];
  expires_at: string | Date | null;
  updated_at: string | Date;
};
type SummaryRow = Pick<
  Row,
  | 'proposal_id'
  | 'kind'
  | 'title'
  | 'status'
  | 'revision'
  | 'classification'
  | 'created_at'
  | 'expires_at'
>;
type ReceiptRow = {
  fingerprint: string;
  proposal_id: string;
  status: ProposalDocument['status'];
  revision: string | number;
  event_id: string;
  server_cursor: string | number;
  occurred_at: string | Date;
};
const classes: Classification[] = ['public', 'internal', 'confidential', 'restricted'];

export function mayReviewProposal(context: RequestContext): boolean {
  return (
    context.actor_type === 'human' &&
    context.authenticated_client === true &&
    (context.capability.includes('proposal.review') || context.roles?.includes('admin') === true)
  );
}

/** A historical proposal is hidden when a linked local source is no longer visible. */
export function proposalVisibility(context: RequestContext, alias = 'p'): string {
  return `EXISTS (SELECT 1 FROM wcp_projects visible_project
    WHERE visible_project.tenant_id = ${alias}.tenant_id AND visible_project.workspace_id = ${alias}.workspace_id
      AND visible_project.id = ${alias}.project_id AND visible_project.deleted_at IS NULL
      ${context.capability.includes('data.restricted.read') ? '' : "AND visible_project.classification <> 'restricted'"})
    AND ${localProposalVisibility(context, alias)} AND (
    NOT (${alias}.provenance ? 'derived_from') OR NOT EXISTS (
      ${proposalLineage(alias)}
      SELECT 1 FROM lineage l WHERE NOT (${localProposalVisibility(context, 'l')}) OR (
        l.provenance ? 'derived_from' AND (
          l.lineage_depth >= 32 OR NOT EXISTS (
            SELECT 1 FROM wcp_proposals parent
            WHERE parent.proposal_id = l.provenance->'derived_from'->>'proposal_id'
              AND parent.tenant_id = l.tenant_id AND parent.workspace_id = l.workspace_id
              AND parent.project_id = l.project_id AND NOT (parent.proposal_id = ANY(l.lineage_path))
          )
        )
      )
    )
  )`;
}

function localProposalVisibility(context: RequestContext, alias: string): string {
  const restricted = context.capability.includes('data.restricted.read');
  return `${restricted ? 'true' : `${alias}.classification <> 'restricted'`} AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(${alias}.source_manifest) m
    LEFT JOIN wcp_context_items s ON s.id = m->>'id' AND s.tenant_id = ${alias}.tenant_id
      AND s.workspace_id = ${alias}.workspace_id AND s.project_id = ${alias}.project_id
    WHERE s.id IS NULL OR s.deleted_at IS NOT NULL ${restricted ? '' : "OR s.classification = 'restricted'"})`;
}

/** A single-parent chain, bounded to 32 derivations and scoped at every hop. */
function proposalLineage(alias: string): string {
  return `WITH RECURSIVE lineage AS (
    SELECT ${alias}.proposal_id, ${alias}.tenant_id, ${alias}.workspace_id, ${alias}.project_id,
      ${alias}.classification, ${alias}.source_manifest, ${alias}.provenance,
      0 AS lineage_depth, ARRAY[${alias}.proposal_id]::text[] AS lineage_path
    UNION ALL
    SELECT parent.proposal_id, parent.tenant_id, parent.workspace_id, parent.project_id,
      parent.classification, parent.source_manifest, parent.provenance,
      l.lineage_depth + 1, l.lineage_path || parent.proposal_id
    FROM lineage l JOIN wcp_proposals parent
      ON parent.proposal_id = l.provenance->'derived_from'->>'proposal_id'
      AND parent.tenant_id = l.tenant_id AND parent.workspace_id = l.workspace_id
      AND parent.project_id = l.project_id
    WHERE l.lineage_depth < 32 AND NOT (parent.proposal_id = ANY(l.lineage_path))
  )`;
}

export function registerProposals(router: CommandRouter, database: RuntimeSql | undefined) {
  router.register('proposal.list', (request) =>
    storage(database, request.context, async (db) => {
      const { input, context } = request;
      let filters: ReturnType<typeof parseProposalListQuery>;
      try {
        filters = parseProposalListQuery(input);
      } catch (error) {
        throw fail(
          context,
          'INVALID_INPUT',
          error instanceof Error ? error.message : 'Invalid proposal filters',
        );
      }
      const limit = filters.limit ?? 25;
      const status = filters.status ?? null;
      const kind = filters.kind ?? null;
      const before = filters.before ?? null;
      const derivedFrom = filters.derived_from ?? null;
      const rows = await db<
        SummaryRow[]
      >`SELECT p.proposal_id, p.kind, p.title, p.status, p.revision, p.classification, p.created_at, p.expires_at
      FROM wcp_proposals p WHERE p.tenant_id = ${context.tenant_id} AND p.workspace_id = ${context.workspace_id} AND p.project_id = ${context.project_id}
        AND ${db.unsafe(proposalVisibility(context))}
        AND (${status}::text IS NULL OR p.status = ${status})
        AND (${kind}::text IS NULL OR p.kind = ${kind})
        AND (${before}::text IS NULL OR p.proposal_id < ${before})
        AND (${derivedFrom}::text IS NULL OR (p.provenance ? 'derived_from'
          AND p.provenance->'derived_from'->>'proposal_id' = ${derivedFrom}))
      ORDER BY p.proposal_id DESC LIMIT ${limit + 1}`;
      const page = rows.slice(0, limit);
      return envelope(
        context,
        {
          proposals: page.map((row) => summary(row, context)),
          review_allowed: mayReviewProposal(context),
          create_allowed:
            context.authenticated_client === true &&
            (context.roles?.includes('admin') === true ||
              context.capability.includes('proposal.write')),
          restricted_read: context.capability.includes('data.restricted.read'),
          ...(rows.length > limit ? { next_before: page[page.length - 1]!.proposal_id } : {}),
        },
        [{ type: 'proposal-list', id: context.project_id }],
      );
    }),
  );
  router.register('proposal.read', (request) =>
    storage(database, request.context, (db) =>
      db.begin('isolation level repeatable read read only', async (tx) => {
        if (Object.keys(request.input).some((key) => key !== 'proposal_id'))
          throw fail(request.context, 'INVALID_INPUT', 'Only proposal_id is accepted');
        const row = await read(
          tx,
          request.context,
          proposalId(request.input.proposal_id, request.context),
        );
        const proposal = document(row, request.context);
        const current = await sourcesCurrent(tx, request.context, row.source_manifest, false);
        return {
          ...envelope(
            request.context,
            {
              proposal,
              sources_current: current,
              review_allowed: mayReviewProposal(request.context),
            },
            [
              { type: 'proposal', id: proposal.proposal_id, revision: proposal.revision },
              ...proposal.source_refs,
            ],
          ),
          revision: proposal.revision,
          etag: buildEtag(proposal.revision),
        };
      }),
    ),
  );
  for (const operation of ['create', 'confirm', 'reject'] as const) {
    router.register('proposal.' + operation, (request) =>
      storage(database, request.context, async (db) => {
        const { context } = request;
        if (context.authenticated_client !== true)
          throw fail(context, 'DENIED', 'An authenticated client is required');
        if (operation !== 'create' && !mayReviewProposal(context))
          throw fail(
            context,
            'DENIED',
            'Review requires a human token and proposal.review permission',
          );
        const scope = scopeOf(context);
        const raw = { ...request.input };
        const key = requestKey(request);
        delete raw.idempotency_key;
        let id: string | undefined;
        let expected: number | undefined;
        let reason: string | undefined;
        let create: ReturnType<typeof parseCreateProposal> | undefined;
        try {
          if (operation === 'create') create = parseCreateProposal(raw);
          else {
            id = proposalId(raw.proposal_id, context);
            expected = reviewRevision(request);
            reason = proposalText(raw.reason, 'reason', 2000);
            if (
              Object.keys(raw).some(
                (field) => !['proposal_id', 'expected_revision', 'reason'].includes(field),
              )
            )
              throw new TypeError('Unknown review field');
          }
        } catch (error) {
          if (error instanceof ContractError) throw error;
          throw fail(
            context,
            'INVALID_INPUT',
            error instanceof Error ? error.message : 'Invalid proposal',
          );
        }
        const receiptKey = commandReceipt(request, key).key;
        const requestHash = fingerprint([operation, id, expected, reason, create]);
        return db.begin(async (tx) => {
          await lockSyncStream(tx, context);
          const [previous] = await tx<
            ReceiptRow[]
          >`SELECT * FROM wcp_proposal_commands WHERE tenant_id = ${scope.tenant_id}
          AND workspace_id = ${scope.workspace_id} AND project_id = ${scope.project_id} AND request_key = ${receiptKey}`;
          if (previous) {
            if (previous.fingerprint !== requestHash)
              throw fail(
                context,
                'IDEMPOTENCY_KEY_REUSED',
                'This key belongs to another proposal command',
              );
            await read(tx, context, previous.proposal_id);
            return result(previous, context, true);
          }
          const now = new Date().toISOString();
          let row: Row;
          if (create) {
            const origin = create.derived_from
              ? await bindOrigin(tx, context, create.derived_from)
              : undefined;
            const bound = await bindSources(tx, context, create.source_refs);
            const classification =
              classes[
                Math.max(
                  classes.indexOf(create.classification),
                  origin === undefined ? 0 : classes.indexOf(origin.classification),
                  ...bound.sources.map((s) => classes.indexOf(s.classification)),
                )
              ]!;
            if (
              classification === 'restricted' &&
              !context.capability.includes('data.restricted.read')
            )
              throw fail(context, 'DENIED', 'Restricted proposals require data.restricted.read');
            const proposal = createUlid();
            const expires = new Date(Date.parse(now) + create.ttl_seconds * 1000).toISOString();
            const provenance = {
              model_version: create.model_version,
              prompt_version: create.prompt_version,
              warnings: proposalWarnings(create.content),
              ...(create.derived_from === undefined ? {} : { derived_from: create.derived_from }),
            };
            const [saved] = await tx<Row[]>`INSERT INTO wcp_proposals
            (proposal_id, tenant_id, workspace_id, project_id, kind, title, content, classification, status, revision,
              source_refs, source_manifest, provenance, created_by, created_by_client, created_at, expires_at, trace_id)
            VALUES (${proposal}, ${scope.tenant_id}, ${scope.workspace_id}, ${scope.project_id}, ${create.kind}, ${create.title}, ${create.content},
              ${classification}, 'proposed', 1, ${JSON.stringify(create.source_refs)}::jsonb, ${JSON.stringify(bound.manifest)}::jsonb,
              ${JSON.stringify(provenance)}::jsonb, ${context.actor_id}, ${context.client_id}, ${now}, ${expires}, ${context.trace_id}) RETURNING *`;
            row = saved!;
          } else {
            const current = await read(tx, context, id!, true);
            if (Number(current.revision) !== expected)
              throw new ContractError(
                'PROPOSAL_VERSION_CONFLICT',
                'Proposal revision changed. Reload before deciding.',
                {
                  trace_id: context.trace_id,
                  current_revision: Number(current.revision),
                  expected_revision: expected,
                },
              );
            if (current.status !== 'proposed')
              throw fail(
                context,
                'PROPOSAL_ALREADY_REVIEWED',
                'This proposal already has a final decision',
              );
            if (operation === 'confirm') {
              if (Date.parse(iso(current.expires_at)) <= Date.now())
                throw fail(
                  context,
                  'PROPOSAL_EXPIRED',
                  'This proposal expired. Submit a fresh proposal.',
                );
              if (!(await sourcesCurrent(tx, context, current.source_manifest, true)))
                throw fail(
                  context,
                  'PROPOSAL_SOURCE_STALE',
                  'A pinned source changed or expired. Submit a fresh proposal before confirming.',
                );
              if (Date.parse(iso(current.expires_at)) <= Date.now())
                throw fail(
                  context,
                  'PROPOSAL_EXPIRED',
                  'This proposal expired while its sources were being checked. Submit a fresh proposal.',
                );
            }
            const [saved] = await tx<
              Row[]
            >`UPDATE wcp_proposals SET status = ${operation === 'confirm' ? 'verified' : 'rejected'}, revision = 2,
            reviewed_by = ${context.actor_id}, reviewed_by_client = ${context.client_id}, reviewed_at = ${now}, review_reason = ${reason!}, trace_id = ${context.trace_id}
            WHERE proposal_id = ${current.proposal_id} AND tenant_id = ${scope.tenant_id} AND workspace_id = ${scope.workspace_id} AND project_id = ${scope.project_id} RETURNING *`;
            row = saved!;
          }
          const eventId = createUlid();
          const cursor = (await highWater(tx, context)) + 1;
          const event: CanonicalEvent = {
            schema_version: 1,
            event_id: eventId,
            event_type: operation === 'create' ? 'ApprovalRequested' : 'ApprovalCompleted',
            ...scope,
            aggregate_type: 'Proposal',
            aggregate_id: row.proposal_id as CanonicalEvent['aggregate_id'],
            aggregate_version: Number(row.revision),
            ...(isUlid(context.actor_id) ? { actor_id: context.actor_id } : {}),
            client_id: context.client_id,
            occurred_at: now,
            trace_id: context.trace_id,
            sensitivity: row.classification,
            source_refs: [
              { type: 'proposal', id: row.proposal_id, revision: Number(row.revision) },
            ],
            payload: {
              proposal_id: row.proposal_id,
              status: row.status,
              revision: Number(row.revision),
              kind: row.kind,
            },
          };
          await appendSyncEvent(tx, event, cursor);
          await tx`INSERT INTO wcp_proposal_commands (tenant_id, workspace_id, project_id, request_key, fingerprint, proposal_id, status, revision, event_id, server_cursor, occurred_at)
          VALUES (${scope.tenant_id}, ${scope.workspace_id}, ${scope.project_id}, ${receiptKey}, ${requestHash}, ${row.proposal_id}, ${row.status}, ${Number(row.revision)}, ${eventId}, ${cursor}, ${now})`;
          return result(
            {
              fingerprint: requestHash,
              proposal_id: row.proposal_id,
              status: row.status,
              revision: Number(row.revision),
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

async function read(
  db: RuntimeSql,
  context: RequestContext,
  id: string,
  lock = false,
): Promise<Row> {
  const [row] = await db<
    Row[]
  >`SELECT p.* FROM wcp_proposals p WHERE p.proposal_id = ${id} AND p.tenant_id = ${context.tenant_id}
    AND p.workspace_id = ${context.workspace_id} AND p.project_id = ${context.project_id}
    AND ${db.unsafe(proposalVisibility(context))} ${db.unsafe(lock ? 'FOR UPDATE OF p' : '')}`;
  if (!row) throw fail(context, 'PROPOSAL_NOT_FOUND', 'Proposal is unavailable in this project');
  validateDocument(row, context);
  return row;
}
function validateDocument(row: Row, context: RequestContext) {
  try {
    if (
      !Array.isArray(row.source_refs) ||
      row.source_refs.length < 1 ||
      row.source_refs.length > 32 ||
      !Array.isArray(row.source_manifest)
    )
      throw new TypeError();
    const pinned = new Map<string, number>();
    for (const raw of row.source_refs) {
      const ref = validateSourceRef(raw);
      if (ref.type !== 'context-item') continue;
      if (
        ref.revision === undefined ||
        ref.revision < 1 ||
        (pinned.has(ref.id) && pinned.get(ref.id) !== ref.revision)
      )
        throw new TypeError();
      pinned.set(ref.id, ref.revision);
    }
    if (
      pinned.size !== row.source_manifest.length ||
      new Set(row.source_manifest.map((s) => s?.id)).size !== pinned.size ||
      row.source_manifest.some(
        (s) =>
          !s ||
          pinned.get(s.id) !== s.revision ||
          typeof s.hash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(s.hash) ||
          (s.dependency_hash !== undefined &&
            (typeof s.dependency_hash !== 'string' || !/^[a-f0-9]{64}$/.test(s.dependency_hash))),
      )
    )
      throw new TypeError();
    if (
      !row.provenance ||
      typeof row.provenance.model_version !== 'string' ||
      typeof row.provenance.prompt_version !== 'string' ||
      !Array.isArray(row.provenance.warnings) ||
      row.provenance.warnings.some((w) => typeof w !== 'string')
    )
      throw new TypeError();
    if (row.provenance.derived_from !== undefined) parseProposalOrigin(row.provenance.derived_from);
  } catch {
    throw fail(
      context,
      'PROPOSAL_INVALID',
      'Stored proposal provenance or source manifest is invalid',
    );
  }
}
async function bindOrigin(db: RuntimeSql, context: RequestContext, origin: ProposalOrigin) {
  const row = await read(db, context, origin.proposal_id, true);
  if (Number(row.revision) !== origin.revision)
    throw fail(
      context,
      'PROPOSAL_VERSION_CONFLICT',
      'The original proposal revision changed. Review it and update derived_from.revision before submitting.',
    );
  const [lineage] = await db<{ depth: number }[]>`SELECT (
    ${db.unsafe(proposalLineage('p'))} SELECT MAX(lineage_depth) FROM lineage
  ) AS depth FROM wcp_proposals p WHERE p.proposal_id = ${origin.proposal_id}
    AND p.tenant_id = ${context.tenant_id} AND p.workspace_id = ${context.workspace_id}
    AND p.project_id = ${context.project_id}`;
  if (!lineage || !Number.isSafeInteger(lineage.depth) || lineage.depth >= 32)
    throw fail(context, 'INVALID_INPUT', 'A proposal can have at most 32 derivation steps');
  return row;
}
async function sourceRows(db: RuntimeSql, context: RequestContext, ids: string[], lock: boolean) {
  const restricted = context.capability.includes('data.restricted.read');
  return db<
    Source[]
  >`SELECT id, version, classification, status, title, content, source_refs, expires_at, updated_at FROM wcp_context_items
    WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id} AND project_id = ${context.project_id}
      AND id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)) AND deleted_at IS NULL
      AND (${restricted} OR classification <> 'restricted') ORDER BY id ${db.unsafe(lock ? 'FOR SHARE' : '')}`;
}
async function bindSources(db: RuntimeSql, context: RequestContext, refs: SourceRef[]) {
  const pinned = new Map<string, number>();
  for (const ref of refs.filter((ref) => ref.type === 'context-item')) {
    if (pinned.has(ref.id) && pinned.get(ref.id) !== ref.revision)
      throw fail(context, 'INVALID_INPUT', 'A context source has conflicting pinned revisions');
    pinned.set(ref.id, ref.revision!);
  }
  const sources = await sourceRows(db, context, [...pinned.keys()], true);
  if (sources.length !== pinned.size)
    throw fail(
      context,
      'PROPOSAL_SOURCE_UNAVAILABLE',
      'A context source is unavailable in this project',
    );
  if (
    sources.some(
      (source) => Number(source.version) !== pinned.get(source.id) || !sourceActive(source),
    )
  )
    throw fail(
      context,
      'PROPOSAL_SOURCE_STALE',
      'A context source revision changed, expired or was excluded',
    );
  const checks = await inspectContextSources(db, context, [...pinned.keys()], { lock: true });
  if ([...checks.values()].some((check) => !check.current))
    throw fail(
      context,
      'PROPOSAL_SOURCE_STALE',
      'A local source chain is stale, unavailable, cyclic or exceeds inspection limits',
    );
  return {
    sources,
    manifest: sources.map((source) => ({
      id: source.id,
      revision: Number(source.version),
      hash: sourceHash(source),
      dependency_hash: checks.get(source.id)!.hash,
    })),
  };
}
async function sourcesCurrent(
  db: RuntimeSql,
  context: RequestContext,
  manifest: Manifest,
  lock: boolean,
): Promise<boolean> {
  if (
    !Array.isArray(manifest) ||
    manifest.length > 32 ||
    new Set(manifest.map((s) => s?.id)).size !== manifest.length ||
    manifest.some(
      (s) =>
        !s ||
        typeof s.id !== 'string' ||
        !Number.isSafeInteger(s.revision) ||
        s.revision < 1 ||
        !/^[a-f0-9]{64}$/.test(s.hash) ||
        (s.dependency_hash !== undefined &&
          (typeof s.dependency_hash !== 'string' || !/^[a-f0-9]{64}$/.test(s.dependency_hash))),
    )
  )
    throw fail(context, 'PROPOSAL_INVALID', 'Stored proposal source manifest is invalid');
  const sources = await sourceRows(
    db,
    context,
    manifest.map((s) => s.id),
    lock,
  );
  const current = new Map(sources.map((s) => [s.id, s]));
  const checks = await inspectContextSources(
    db,
    context,
    manifest.map((s) => s.id),
    { lock },
  );
  return manifest.every((entry) => {
    const source = current.get(entry.id);
    return (
      source !== undefined &&
      sourceActive(source) &&
      Number(source.version) === entry.revision &&
      sourceHash(source) === entry.hash &&
      entry.dependency_hash !== undefined &&
      checks.get(entry.id)?.current === true &&
      checks.get(entry.id)?.hash === entry.dependency_hash
    );
  });
}
function sourceActive(source: Source) {
  return (
    !['expired', 'excluded'].includes(source.status) &&
    (source.expires_at === null || Date.parse(iso(source.expires_at)) > Date.now())
  );
}
function sourceHash(source: Source) {
  return fingerprint({
    ...source,
    version: Number(source.version),
    expires_at: source.expires_at === null ? null : iso(source.expires_at),
    updated_at: iso(source.updated_at),
  });
}
function summary(row: SummaryRow, context: RequestContext): ProposalSummary {
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 1 || !isUlid(row.proposal_id))
    throw fail(context, 'PROPOSAL_INVALID', 'Stored proposal is invalid');
  return {
    proposal_id: row.proposal_id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    revision,
    classification: row.classification,
    created_at: iso(row.created_at),
    expires_at: iso(row.expires_at),
  };
}
function document(row: Row, context: RequestContext): ProposalDocument {
  const { source_manifest: _manifest, ...fields } = row;
  return {
    ...fields,
    ...summary(row, context),
    schema_version: 1,
    reviewed_at: row.reviewed_at === null ? null : iso(row.reviewed_at),
  };
}
function result(row: ReceiptRow, context: RequestContext, replayed: boolean) {
  const revision = Number(row.revision);
  const cursor = Number(row.server_cursor);
  if (
    !isUlid(row.proposal_id) ||
    !isUlid(row.event_id) ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !Number.isSafeInteger(cursor) ||
    cursor < 1
  )
    throw fail(context, 'PROPOSAL_INVALID', 'Stored proposal receipt is invalid');
  const data: ProposalMutationReceipt = {
    proposal_id: row.proposal_id,
    status: row.status,
    revision,
    event_id: row.event_id,
    occurred_at: iso(row.occurred_at),
    replayed,
  };
  return {
    ...envelope(context, data, [{ type: 'proposal', id: row.proposal_id, revision }]),
    revision,
    etag: buildEtag(revision),
    server_cursor: cursor,
  };
}
function envelope(context: RequestContext, data: unknown, source_refs: SourceRef[]) {
  return { schema_version: 1 as const, data, trace_id: context.trace_id, source_refs };
}
function proposalId(value: unknown, context: RequestContext) {
  if (!isUlid(value)) throw fail(context, 'INVALID_INPUT', 'proposal_id must be a ULID');
  return value;
}
function scopeOf(context: RequestContext): ContextScope {
  const { tenant_id, workspace_id, project_id } = context;
  if (!isUlid(tenant_id) || !isUlid(workspace_id) || !isUlid(project_id))
    throw fail(context, 'INVALID_INPUT', 'Project scope requires ULIDs');
  return { tenant_id, workspace_id, project_id };
}
function requestKey(request: CommandRequest): string {
  try {
    if (
      request.context.idempotency_key !== undefined &&
      request.input.idempotency_key !== undefined &&
      request.context.idempotency_key !== request.input.idempotency_key
    )
      throw new TypeError();
    return validateIdempotencyKey(request.context.idempotency_key ?? request.input.idempotency_key);
  } catch {
    throw fail(request.context, 'INVALID_INPUT', 'A matching stable idempotency key is required');
  }
}
function reviewRevision(request: CommandRequest): number {
  const value = request.context.expected_version ?? request.input.expected_revision;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    (request.context.expected_version !== undefined &&
      request.input.expected_revision !== undefined &&
      request.context.expected_version !== request.input.expected_revision)
  )
    throw fail(request.context, 'INVALID_INPUT', 'Supply matching expected_revision or If-Match');
  return value;
}
function iso(value: Date | string) {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime()))
    throw new ContractError('PROPOSAL_INVALID', 'Stored proposal timestamp is invalid');
  return time.toISOString();
}
function fail(context: RequestContext, code: string, message: string) {
  return new ContractError(code, message, { trace_id: context.trace_id });
}
async function storage<T>(
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
    'PROPOSAL_STORAGE_UNAVAILABLE',
    'Proposal storage did not confirm the operation. Retry with the same request key.',
    { trace_id: context.trace_id, retryable: true },
  );
}
