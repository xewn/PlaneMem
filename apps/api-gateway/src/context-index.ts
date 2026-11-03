import { createHash } from 'node:crypto';
import {
  ContractError,
  parseIndexedContextInput,
  type IndexedContextInput,
} from '@planemem/contracts';
import type { SearchHit } from '@planemem/search-service';
import type { RequestContext } from './router.js';
import { persistContextHit, type RuntimeSql } from './runtime-persistence.js';

/** Receipt and index commit together; external capture can leave an orphan on DB failure. */
export async function recordContextIndex(
  db: RuntimeSql,
  context: RequestContext,
  key: string,
  input: IndexedContextInput,
  capture: () => Promise<Array<{ type: string; id: string }>>,
): Promise<SearchHit> {
  const { tenant_id, workspace_id, project_id, actor_id, client_id, trace_id } = context;
  const identity = JSON.stringify([tenant_id, workspace_id, project_id, actor_id, client_id, key]);
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return db.begin(async (transaction) => {
    const tx = transaction as unknown as RuntimeSql;
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))`;
    // Serialize distinct request keys targeting one record before external capture.
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['context-index', tenant_id, workspace_id, project_id, input.id])}, 0))`;
    const projects =
      await tx`SELECT id FROM wcp_projects WHERE tenant_id = ${tenant_id} AND workspace_id = ${workspace_id}
      AND id = ${project_id} AND deleted_at IS NULL
      AND (${context.capability.includes('data.restricted.read')} OR classification <> 'restricted') FOR SHARE`;
    if (!projects.length)
      throw new ContractError('DENIED', 'Project is not writable in this scope', { trace_id });
    const current =
      await tx`SELECT revision::text AS revision, classification, deleted_at, expires_at,
        (expires_at IS NOT NULL AND expires_at <= clock_timestamp()) AS expired,
        (extract(epoch FROM clock_timestamp()) * 1000)::double precision AS checked_at_ms
      FROM wcp_context_hits WHERE tenant_id = ${tenant_id} AND workspace_id = ${workspace_id}
        AND project_id = ${project_id} AND id = ${input.id} FOR UPDATE`;
    const row = current[0];
    if (
      row?.classification === 'restricted' &&
      !context.capability.includes('data.restricted.read')
    )
      throw new ContractError('DENIED', 'Context record is not writable in this scope', {
        trace_id,
      });
    const receipts = await tx`SELECT fingerprint, receipt FROM wcp_context_index_receipts
      WHERE tenant_id = ${tenant_id} AND workspace_id = ${workspace_id} AND project_id = ${project_id}
        AND actor_id = ${actor_id} AND client_id = ${client_id} AND request_key = ${key}`;
    const existing = receipts[0];
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new ContractError(
          'IDEMPOTENCY_KEY_REUSED',
          'Context index key belongs to another request',
          { trace_id },
        );
      const receipt = existing.receipt as SearchHit;
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt))
        throw new ContractError('SEARCH_RESULT_INVALID', 'Saved index receipt is invalid', {
          trace_id,
        });
      if (
        !row ||
        row.deleted_at !== null ||
        row.expired === true ||
        ((receipt.classification ?? 'restricted') === 'restricted' &&
          !context.capability.includes('data.restricted.read'))
      )
        throw new ContractError('DENIED', 'Saved index receipt is no longer readable', {
          trace_id,
        });
      try {
        const { schema_version, tenant_id: t, workspace_id: w, project_id: p, ...body } = receipt;
        if (
          schema_version !== 1 ||
          t !== tenant_id ||
          w !== workspace_id ||
          p !== project_id ||
          body.id !== input.id ||
          body.revision !== input.revision
        )
          throw new Error();
        const parsed = parseIndexedContextInput(body);
        const appended = parsed.source_refs.slice(input.source_refs.length);
        const original = {
          ...parsed,
          source_refs: parsed.source_refs.slice(0, input.source_refs.length),
        };
        if (
          createHash('sha256').update(JSON.stringify(original)).digest('hex') !== fingerprint ||
          appended.length > 1 ||
          appended.some(
            (ref) =>
              ref.type !== 'ai-memory' || ref.revision !== undefined || ref.uri !== undefined,
          ) ||
          typeof row.revision !== 'string' ||
          !/^(0|[1-9][0-9]*)$/.test(row.revision) ||
          BigInt(row.revision) < BigInt(parsed.revision) ||
          typeof row.checked_at_ms !== 'number' ||
          !Number.isFinite(row.checked_at_ms) ||
          typeof row.expired !== 'boolean'
        )
          throw new Error();
        if (parsed.expires_at !== null && Date.parse(parsed.expires_at) <= row.checked_at_ms)
          throw new ContractError('DENIED', 'Saved index content has expired', { trace_id });
        return { ...parsed, schema_version: 1, tenant_id, workspace_id, project_id };
      } catch (error) {
        if (error instanceof ContractError) throw error;
        throw new ContractError('SEARCH_RESULT_INVALID', 'Saved index receipt is invalid', {
          trace_id,
        });
      }
    }
    const levels = ['public', 'internal', 'confidential', 'restricted'];
    if (
      row &&
      (row.deleted_at !== null ||
        BigInt(row.revision as string) >= BigInt(input.revision) ||
        levels.indexOf(row.classification as string) > levels.indexOf(input.classification))
    )
      throw new ContractError(
        'CONTEXT_INDEX_VERSION_CONFLICT',
        'Use a higher revision without reducing classification; deleted records cannot be re-indexed',
        { trace_id },
      );
    const memoryRefs = await capture();
    const hit: SearchHit = {
      ...input,
      schema_version: 1,
      tenant_id,
      workspace_id,
      project_id,
      source_refs: [...input.source_refs, ...memoryRefs],
    };
    await persistContextHit(tx, hit, trace_id);
    await tx`INSERT INTO wcp_context_index_receipts (tenant_id, workspace_id, project_id, actor_id, client_id, request_key, fingerprint, receipt)
      VALUES (${tenant_id}, ${workspace_id}, ${project_id}, ${actor_id}, ${client_id}, ${key}, ${fingerprint}, ${JSON.stringify(hit)}::jsonb)`;
    return hit;
  });
}
