import {
  ContractError,
  parseConflictReceiptQuery,
  assertConflictReceiptIdentity,
  parseConflictReceiptEnvelope,
  parseConflictVersion,
  CONFLICT_RECEIPT_METADATA_BYTES,
  conflictReceiptJson,
  isUlid,
} from '@planemem/contracts';
import { commandReceipt } from './http.js';
import type { CommandRouter, RequestContext } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';
import { visibleConflicts } from './workbench/repository.js';

export function canReadConflictReceipt(context: RequestContext): boolean {
  const expires = Date.parse(context.token_expires_at ?? '');
  return (
    context.authenticated_client === true &&
    Number.isFinite(expires) &&
    expires > Date.now() &&
    (context.roles?.includes('admin') === true || context.capability.includes('conflict.resolve'))
  );
}

export function registerConflictReceipts(router: CommandRouter, db: RuntimeSql | undefined) {
  router.register('conflict.receipt', async (request) => {
    const context = structuredClone(request.context);
    const { trace_id, tenant_id, workspace_id, project_id } = context;
    if (!canReadConflictReceipt(context))
      throw new ContractError('DENIED', 'A verified unexpired conflict resolver is required', {
        trace_id,
      });
    let query;
    try {
      if (context.idempotency_key !== undefined || context.expected_version !== undefined)
        throw new TypeError();
      query = parseConflictReceiptQuery(request.input);
    } catch {
      throw new ContractError(
        'INVALID_INPUT',
        'Supply the saved identity, request_key and complete original command without outer write conditions',
        { trace_id },
      );
    }
    try {
      assertConflictReceiptIdentity(query.identity, context);
    } catch {
      throw new ContractError(
        'DENIED',
        'Original decision identity differs from the verified session',
        { trace_id },
      );
    }
    const binding = commandReceipt(
      {
        operation: 'conflict.resolve',
        input: query.command,
        context: { ...context, expected_version: query.command.expected_version },
      },
      query.request_key,
    );
    if (!db) throw unavailable(trace_id);
    try {
      const [row] = await db<Record<string, unknown>[]>`
        WITH saved AS MATERIALIZED (
          SELECT jsonb_build_object(
            'status', c.status, 'version', c.version::text, 'resolution', c.resolution,
            'actor_id', c.actor_id, 'client_id', c.resolved_by_client,
            'recorded_at', to_char(c.resolved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'event_id', c.resolution_event_id, 'original_trace_id', c.trace_id, 'server_cursor', e.server_cursor::text,
            'has_key', c.resolution_request_key IS NOT NULL, 'has_fingerprint', c.resolution_fingerprint IS NOT NULL,
            'has_value', c.resolved_value IS NOT NULL,
            'key_matches', (c.resolution_request_key = ${binding.key}) IS TRUE,
            'fingerprint_matches', (c.resolution_fingerprint = ${binding.fingerprint}) IS TRUE,
            'event_matches', (
              e.event_type = 'ConflictResolved' AND e.trace_id = c.trace_id
              AND e.payload->>'event_type' = 'ConflictResolved' AND e.payload->'schema_version' = '1'::jsonb
              AND e.payload->>'event_id' = c.resolution_event_id
              AND e.payload->>'tenant_id' = c.tenant_id AND e.payload->>'workspace_id' = c.workspace_id AND e.payload->>'project_id' = c.project_id
              AND e.payload->>'aggregate_type' = 'Conflict'
              AND e.payload->>'aggregate_id' = CASE WHEN ${isUlid(query.command.conflict_id)} THEN c.conflict_id ELSE c.resolution_event_id END
              AND e.payload->'aggregate_version' = to_jsonb(c.version)
              AND e.payload->>'client_id' = c.resolved_by_client AND e.payload->>'trace_id' = c.trace_id
              AND e.payload->>'occurred_at' = to_char(c.resolved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
              AND e.payload->'payload'->>'conflict_id' = c.conflict_id
              AND e.payload->'payload'->>'entity_type' = c.entity_type AND e.payload->'payload'->>'entity_id' = c.entity_id
              AND e.payload->'payload'->>'field' = c.field AND e.payload->'payload'->>'actor_id' = c.actor_id
              AND e.payload->'payload'->>'resolution' = c.resolution
              AND e.payload->'payload'->'resolved_value' = c.resolved_value
              AND (${query.command.resolution !== 'merge'} OR c.resolved_value = ${JSON.stringify(query.command.merged_value ?? null)}::jsonb)
            ) IS TRUE
          ) AS metadata
          FROM wcp_conflicts c
          LEFT JOIN wcp_sync_events e ON e.event_id = c.resolution_event_id AND e.tenant_id = c.tenant_id
            AND e.workspace_id = c.workspace_id AND e.project_id = c.project_id
          WHERE c.conflict_id = ${query.command.conflict_id} AND c.tenant_id = ${tenant_id} AND c.workspace_id = ${workspace_id} AND c.project_id = ${project_id}
            AND (e.event_id IS NULL OR (e.payload->>'sensitivity' IN ('public', 'internal', 'confidential', 'restricted')
              AND (e.payload->>'sensitivity' <> 'restricted' OR ${context.capability.includes('data.restricted.read')})))
            AND EXISTS (SELECT 1 FROM wcp_projects p WHERE p.id = c.project_id AND p.tenant_id = c.tenant_id AND p.workspace_id = c.workspace_id
              AND p.deleted_at IS NULL AND p.classification IN ('public', 'internal', 'confidential', 'restricted')
              AND (p.classification <> 'restricted' OR ${context.capability.includes('data.restricted.read')}))
            ${db.unsafe(visibleConflicts({ ...context, read_restricted: context.capability.includes('data.restricted.read') }))}
        ) SELECT CASE WHEN octet_length(metadata::text) <= ${CONFLICT_RECEIPT_METADATA_BYTES} THEN metadata ELSE NULL END AS metadata FROM saved`;
      if (!row)
        throw new ContractError('CONFLICT_NOT_FOUND', 'Conflict is unavailable in this project', {
          trace_id,
        });
      if (
        typeof row.metadata === 'string' &&
        new TextEncoder().encode(row.metadata).byteLength > CONFLICT_RECEIPT_METADATA_BYTES
      )
        throw new TypeError();
      const metadata: unknown =
        typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      conflictReceiptJson(metadata, CONFLICT_RECEIPT_METADATA_BYTES);
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
        throw new TypeError();
      const saved = metadata as Record<string, unknown>;
      const fields = [
        'status',
        'version',
        'resolution',
        'actor_id',
        'client_id',
        'recorded_at',
        'event_id',
        'original_trace_id',
        'server_cursor',
        'has_key',
        'has_fingerprint',
        'has_value',
        'key_matches',
        'fingerprint_matches',
        'event_matches',
      ];
      if (
        fields.some((field) => !Object.hasOwn(saved, field)) ||
        Object.keys(saved).some((field) => !fields.includes(field)) ||
        (saved.event_id !== null && !isUlid(saved.event_id)) ||
        (saved.key_matches === true && saved.has_key !== true) ||
        (saved.fingerprint_matches === true && saved.has_fingerprint !== true)
      )
        throw new TypeError();
      if (
        !['open', 'resolved'].includes(saved.status as string) ||
        [
          'has_key',
          'has_fingerprint',
          'has_value',
          'key_matches',
          'fingerprint_matches',
          'event_matches',
        ].some((key) => typeof saved[key] !== 'boolean')
      )
        throw new TypeError();
      parseConflictVersion(saved.version, true);
      let data: unknown = { ...query, status: 'not-observed' };
      let source_refs: { type: string; id: string }[] = [];
      if (saved.status === 'open') {
        if (
          saved.has_key ||
          saved.has_fingerprint ||
          saved.has_value ||
          saved.event_id !== null ||
          saved.resolution !== null ||
          saved.recorded_at !== null ||
          saved.client_id !== null
        )
          throw new TypeError();
      } else {
        if (!saved.has_key || !saved.has_fingerprint || saved.event_id === null)
          throw new ContractError(
            'CONFLICT_RECEIPT_LEGACY_UNVERIFIED',
            'The saved decision has no complete original request binding',
            { trace_id },
          );
        if (saved.key_matches) {
          if (!saved.fingerprint_matches)
            throw new ContractError(
              'IDEMPOTENCY_KEY_REUSED',
              'The original key is bound to different decision parameters',
              { trace_id },
            );
          if (saved.event_matches !== true || saved.has_value !== true) throw new TypeError();
          data = {
            ...query,
            status: 'recorded',
            receipt: {
              conflict_id: query.command.conflict_id,
              version: saved.version,
              resolution: saved.resolution,
              event_id: saved.event_id,
              server_cursor: saved.server_cursor,
              actor_id: saved.actor_id,
              client_id: saved.client_id,
              recorded_at: saved.recorded_at,
              original_trace_id: saved.original_trace_id,
              source_application: 'not-checked',
            },
          };
          source_refs = [{ type: 'event', id: saved.event_id as string }];
        }
      }
      return parseConflictReceiptEnvelope(
        { schema_version: 1, trace_id, source_refs, data },
        query,
        trace_id,
      );
    } catch (error) {
      if (error instanceof ContractError) throw error;
      if (error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError)
        throw new ContractError(
          'CONFLICT_RECEIPT_INVALID',
          'Saved conflict receipt could not be validated; keep the original request',
          { trace_id },
        );
      throw unavailable(trace_id);
    }
  });
}
function unavailable(trace_id: string) {
  return new ContractError(
    'CONFLICT_STORAGE_UNAVAILABLE',
    'Original conflict receipt could not be read; keep the saved request',
    { trace_id, retryable: true },
  );
}
