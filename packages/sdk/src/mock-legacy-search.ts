import {
  ContractError,
  compareObservedExternalIds,
  parseIndexedContextInput,
  parseLegacySearchQuery,
  parseLegacySearchEnvelope,
  parseObservedRecordId,
  syncJsonSnapshot,
  validateSourceRef,
  type IndexedContextInput,
  type LegacySearchQuery,
  type LegacySearchHit,
  type LegacyMemorySearchHit,
  type SearchResponseScope,
  type SourceRef,
} from '@planemem/contracts';

export type MockMemoryRecall =
  | { mode: 'off'; required: boolean }
  | {
      mode: 'configured';
      required: boolean;
      outcome:
        | {
            kind: 'recalled';
            hits: Array<{
              id: string;
              snippet: string;
              revision: number;
              source_refs: SourceRef[];
            }>;
          }
        | {
            kind: 'failed';
            code:
              | 'MEMORY_PROVIDER_OFF'
              | 'MEMORY_UNAVAILABLE'
              | 'MEMORY_SCOPE_MISMATCH'
              | 'MEMORY_RESULT_INVALID';
          };
    };
export interface MockLegacySearchSeed {
  queries: Array<{
    query: string;
    /** Every eligible current title/snippet needs a match score or an explicit null nonmatch. */
    evaluations: Array<{ id: string; title: string; snippet: string; score: number | null }>;
    memory: MockMemoryRecall;
  }>;
}
type Item = { content: IndexedContextInput; updated_at: string; deleted_at: string | null };
type Scenario = { evaluations: Map<string, number | null>; memory: MockMemoryRecall };
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== names.length || names.some((name) => !Object.hasOwn(row, name)))
    throw new TypeError();
  return row;
}
function contentKey(content: Pick<IndexedContextInput, 'id' | 'title' | 'snippet'>) {
  return JSON.stringify([content.id, content.title, content.snippet]);
}
function fail(code: string, trace: string): never {
  throw new ContractError(
    code,
    'The simulated search scenario or required memory recall is unavailable',
    {
      trace_id: trace,
      retryable: false,
    },
  );
}

/** FTS evaluations are explicit fixtures; current metadata always comes from the mutable index. */
export class MockLegacySearch {
  readonly #queries = new Map<string, Scenario>();
  constructor(seed: MockLegacySearchSeed) {
    const input = fields(JSON.parse(syncJsonSnapshot(seed, 16 * 1024 * 1024)), ['queries']);
    if (!Array.isArray(input.queries) || input.queries.length > 1000) throw new TypeError();
    for (const value of input.queries) {
      const row = fields(value, ['query', 'evaluations', 'memory']);
      const query = parseLegacySearchQuery({ query: row.query }).query;
      if (
        this.#queries.has(query) ||
        !Array.isArray(row.evaluations) ||
        row.evaluations.length > 1000
      )
        throw new TypeError();
      const evaluations = new Map<string, number | null>();
      for (const value of row.evaluations) {
        const evaluation = fields(value, ['id', 'title', 'snippet', 'score']);
        const parsed = parseIndexedContextInput({
          ...evaluation,
          revision: 0,
          source_refs: [],
          score: evaluation.score ?? 0,
        });
        const score = evaluation.score;
        if (
          score !== null &&
          (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1)
        )
          throw new TypeError();
        const key = contentKey(parsed);
        if (evaluations.has(key)) throw new TypeError();
        evaluations.set(key, score);
      }
      const rawMemory = row.memory;
      if (!rawMemory || typeof rawMemory !== 'object' || Array.isArray(rawMemory))
        throw new TypeError();
      const memory = fields(
        rawMemory,
        (rawMemory as { mode?: unknown }).mode === 'off'
          ? ['mode', 'required']
          : ['mode', 'required', 'outcome'],
      );
      if (
        typeof memory.required !== 'boolean' ||
        !['off', 'configured'].includes(memory.mode as string)
      )
        throw new TypeError();
      let normalized: MockMemoryRecall;
      if (memory.mode === 'off') normalized = { mode: 'off', required: memory.required };
      else {
        const outcome = memory.outcome as Record<string, unknown> | null;
        if (outcome?.kind === 'recalled') {
          fields(outcome, ['kind', 'hits']);
          if (!Array.isArray(outcome.hits) || outcome.hits.length > 1000) throw new TypeError();
          // Validate every provider hit before runtime deduplication or budget truncation.
          const hits = outcome.hits.map((value) => {
            const hit = fields(value, ['id', 'snippet', 'revision', 'source_refs']);
            const id = parseObservedRecordId(hit.id);
            if (
              typeof hit.snippet !== 'string' ||
              hit.snippet.length > 65536 ||
              typeof hit.revision !== 'number' ||
              !Number.isSafeInteger(hit.revision) ||
              hit.revision < 0 ||
              !Array.isArray(hit.source_refs) ||
              hit.source_refs.length > 64
            )
              throw new TypeError();
            return {
              id,
              snippet: hit.snippet,
              revision: hit.revision,
              source_refs: hit.source_refs.map(validateSourceRef),
            };
          });
          normalized = {
            mode: 'configured',
            required: memory.required,
            outcome: { kind: 'recalled', hits },
          };
        } else {
          const failure = fields(outcome, ['kind', 'code']);
          if (
            failure.kind !== 'failed' ||
            ![
              'MEMORY_PROVIDER_OFF',
              'MEMORY_UNAVAILABLE',
              'MEMORY_SCOPE_MISMATCH',
              'MEMORY_RESULT_INVALID',
            ].includes(failure.code as string)
          )
            throw new TypeError();
          normalized = {
            mode: 'configured',
            required: memory.required,
            outcome: {
              kind: 'failed',
              code: failure.code as Extract<
                Extract<MockMemoryRecall, { mode: 'configured' }>['outcome'],
                { kind: 'failed' }
              >['code'],
            },
          };
        }
      }
      this.#queries.set(query, { evaluations, memory: normalized });
    }
  }

  search(
    input: LegacySearchQuery,
    scope: SearchResponseScope,
    trace: string,
    eligible: readonly Item[],
    access: { parent_visible: boolean; read_restricted: boolean },
    now: number,
  ) {
    const query = parseLegacySearchQuery(input);
    const scenario = this.#queries.get(query.query);
    if (!scenario) fail('MOCK_SEARCH_SCENARIO_UNCONFIGURED', trace);
    const local: Array<{ hit: LegacySearchHit; updated: string }> = [];
    for (const item of eligible) {
      if (
        item.deleted_at !== null ||
        (item.content.expires_at !== null && Date.parse(item.content.expires_at) <= now)
      )
        continue;
      const score = scenario.evaluations.get(contentKey(item.content));
      if (score === undefined) fail('MOCK_SEARCH_SCENARIO_UNCONFIGURED', trace);
      if (score === null) continue;
      local.push({
        hit: { ...item.content, ...scope, schema_version: 1, rank_source: 'fts', score },
        updated: item.updated_at,
      });
    }
    local.sort(
      (a, b) =>
        b.hit.score - a.hit.score ||
        (a.updated === b.updated ? 0 : a.updated > b.updated ? -1 : 1) ||
        compareObservedExternalIds(a.hit.id, b.hit.id),
    );
    const memory = scenario.memory;
    let used = false,
      degraded = false;
    const recalled = new Map<string, LegacyMemorySearchHit>();
    if (memory.mode === 'off') {
      if (memory.required) fail('MEMORY_PROVIDER_OFF', trace);
    } else if (!access.read_restricted) {
      if (memory.required) fail('DENIED', trace);
      degraded = true;
    } else {
      // Production checks parent visibility before optional provider failure handling.
      if (!access.parent_visible) fail('DENIED', trace);
      if (memory.outcome.kind === 'failed') {
        if (memory.required) fail(memory.outcome.code, trace);
        degraded = true;
      } else {
        used = true;
        for (const hit of memory.outcome.hits) {
          if (recalled.has(hit.id)) continue;
          recalled.set(hit.id, {
            ...hit,
            ...scope,
            schema_version: 1,
            title: 'ai-memory',
            classification: 'restricted',
            rank_source: 'memory',
            score: 1 / (recalled.size + 1),
          });
        }
      }
    }
    const hits = [...local.map((row) => row.hit), ...recalled.values()].slice(0, query.budget);
    const source_refs = hits.flatMap((hit) => hit.source_refs);
    return parseLegacySearchEnvelope(
      {
        schema_version: 1,
        trace_id: trace,
        source_refs,
        data: {
          schema_version: 1,
          trace_id: trace,
          query: query.query,
          scope,
          hits,
          source_refs,
          degraded: query.use_vector || degraded,
          backend: 'postgres',
          vector_used: false,
          memory_used: used,
        },
      },
      query,
      scope,
      trace,
    );
  }
}
