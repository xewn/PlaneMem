import { ContractError, parseObservedRecordId, validateSourceRef } from '@planemem/contracts';
import type { MemoryScope, MemoryServiceAdapter } from '@planemem/context-service';
import type { SearchHit } from '@planemem/search-service';
import type { RequestContext } from './router.js';

/** External recall has no per-record classification; all returned content is restricted. */
export async function recallProjectMemory(
  memory: MemoryServiceAdapter | undefined,
  required: boolean,
  context: RequestContext,
  query: string,
  limit: number,
): Promise<{ hits: SearchHit[]; used: boolean; degraded: boolean }> {
  if (!memory) {
    if (required)
      throw new ContractError('MEMORY_PROVIDER_OFF', 'Required memory provider is not configured', {
        trace_id: context.trace_id,
      });
    return { hits: [], used: false, degraded: false };
  }
  if (!context.capability.includes('data.restricted.read')) {
    if (required)
      throw new ContractError(
        'DENIED',
        'External memory without classification requires restricted data access',
        {
          trace_id: context.trace_id,
        },
      );
    return { hits: [], used: false, degraded: true };
  }
  try {
    const hits = await memory.recall({
      tenant_id: context.tenant_id as MemoryScope['tenant_id'],
      workspace_id: context.workspace_id as MemoryScope['workspace_id'],
      project_id: context.project_id as MemoryScope['project_id'],
      query,
      trace_id: context.trace_id,
    });
    // Validate the entire response before selecting results; do not retain a partial cross-scope batch.
    if (
      !Array.isArray(hits) ||
      hits.length > 1000 ||
      hits.some(
        (hit) =>
          !hit ||
          hit.tenant_id !== context.tenant_id ||
          hit.workspace_id !== context.workspace_id ||
          hit.project_id !== context.project_id ||
          !validPageId(hit.page_ref) ||
          typeof hit.snippet !== 'string' ||
          hit.snippet.length > 65536 ||
          !Number.isSafeInteger(hit.revision) ||
          hit.revision < 0 ||
          !Array.isArray(hit.source_refs) ||
          hit.source_refs.length > 64,
      )
    )
      throw new ContractError(
        'MEMORY_SCOPE_MISMATCH',
        'Memory recall returned invalid or cross-scope records',
        { trace_id: context.trace_id },
      );
    let normalized;
    try {
      normalized = hits.map((hit) => ({
        ...hit,
        source_refs: hit.source_refs.map(validateSourceRef),
      }));
    } catch {
      throw new ContractError('MEMORY_RESULT_INVALID', 'Memory recall returned invalid sources', {
        trace_id: context.trace_id,
      });
    }
    const unique = new Map<string, SearchHit>();
    for (const hit of normalized) {
      if (unique.has(hit.page_ref)) continue;
      unique.set(hit.page_ref, {
        schema_version: 1,
        tenant_id: context.tenant_id,
        workspace_id: context.workspace_id,
        project_id: context.project_id,
        id: hit.page_ref,
        title: 'ai-memory',
        snippet: hit.snippet,
        revision: hit.revision,
        score: 1 / (unique.size + 1),
        rank_source: 'memory',
        classification: 'restricted',
        source_refs: hit.source_refs,
      });
    }
    return { hits: [...unique.values()].slice(0, limit), used: true, degraded: false };
  } catch (error) {
    if (required) {
      if (error instanceof ContractError) throw error;
      throw new ContractError('MEMORY_UNAVAILABLE', 'Required memory recall failed', {
        trace_id: context.trace_id,
        retryable: true,
      });
    }
    return { hits: [], used: false, degraded: true };
  }
}

function validPageId(value: unknown): boolean {
  try {
    parseObservedRecordId(value);
    return true;
  } catch {
    return false;
  }
}
