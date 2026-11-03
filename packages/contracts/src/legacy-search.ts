import { validateSourceRef, type Classification, type SourceRef } from './metadata.js';
import { parseWorkItemProjectionQuery } from './work-item-projection.js';

export interface LegacySearchQuery {
  query: string;
  budget?: number;
  use_vector?: boolean;
}
export interface IndexedContextInput {
  id: string;
  title: string;
  snippet: string;
  revision: number;
  score: number;
  source_refs: SourceRef[];
  rank_source: 'fts' | 'vector' | 'rrf';
  classification: Classification;
  expires_at: string | null;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected an object');
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000\p{Cs}]/u.test(value)
  )
    throw new TypeError(`${field} must be non-empty text of at most ${max} characters`);
  return value;
}
export function parseLegacySearchQuery(value: unknown): Required<LegacySearchQuery> {
  const input = record(value);
  if (Object.keys(input).some((key) => !['query', 'budget', 'use_vector'].includes(key)))
    throw new TypeError('Unknown search field');
  const budget = input.budget === undefined ? 20 : input.budget;
  const use_vector = input.use_vector === undefined ? false : input.use_vector;
  if (typeof budget !== 'number' || !Number.isSafeInteger(budget) || budget < 1 || budget > 100)
    throw new TypeError('budget must be between 1 and 100');
  if (typeof use_vector !== 'boolean') throw new TypeError('use_vector must be boolean');
  return { query: text(input.query, 'query', 500).trim(), budget, use_vector };
}
export function parseIndexedContextInput(value: unknown): IndexedContextInput {
  const input = record(value);
  if (
    Object.keys(input).some(
      (key) =>
        ![
          'id',
          'title',
          'snippet',
          'revision',
          'score',
          'source_refs',
          'rank_source',
          'classification',
          'expires_at',
        ].includes(key),
    )
  )
    throw new TypeError('Unknown context index field');
  const { item_id: id } = parseWorkItemProjectionQuery({ item_id: input.id });
  if (id === '.' || id === '..') throw new TypeError('Index ID cannot be a relative path segment');
  if (
    typeof input.revision !== 'number' ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0
  )
    throw new TypeError('revision must be a non-negative safe integer');
  if (typeof input.score !== 'number' || !Number.isFinite(input.score))
    throw new TypeError('score must be finite');
  const classification = input.classification === undefined ? 'restricted' : input.classification;
  const rank_source = input.rank_source === undefined ? 'fts' : input.rank_source;
  if (!['public', 'internal', 'confidential', 'restricted'].includes(classification as string))
    throw new TypeError('Invalid classification');
  if (!['fts', 'vector', 'rrf'].includes(rank_source as string))
    throw new TypeError('Invalid rank source');
  const expires = input.expires_at === undefined ? null : input.expires_at;
  if (
    expires !== null &&
    (typeof expires !== 'string' || !/Z$/.test(expires) || !Number.isFinite(Date.parse(expires)))
  )
    throw new TypeError('expires_at must be a UTC timestamp or null');
  if (!Array.isArray(input.source_refs) || input.source_refs.length > 64)
    throw new TypeError('source_refs must contain at most 64 entries');
  return {
    id,
    title: text(input.title, 'title', 1000),
    snippet: text(input.snippet, 'snippet', 65536),
    revision: input.revision,
    score: input.score,
    classification: classification as Classification,
    rank_source: rank_source as IndexedContextInput['rank_source'],
    expires_at: expires === null ? null : new Date(expires as string).toISOString(),
    source_refs: input.source_refs.map((value) => {
      const ref = validateSourceRef(value);
      return {
        type: ref.type,
        id: ref.id,
        ...(ref.revision === undefined ? {} : { revision: ref.revision }),
        ...(ref.uri === undefined ? {} : { uri: ref.uri }),
      };
    }),
  };
}
