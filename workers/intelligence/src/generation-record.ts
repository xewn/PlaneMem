import { createHash } from 'node:crypto';
import {
  ContractError,
  isUlid,
  parseCreateProposal,
  syncJsonSnapshot,
  type Classification,
} from '@planemem/contracts';
import {
  PROPOSAL_GENERATION_PROMPT,
  parseProposalGenerationProvider,
  parseProposalGenerationRequest,
  type GeneratedProposalDraft,
  type ProposalGenerationProvider,
} from './generation.js';
import {
  parseProposalGenerationSelection,
  type PreparedProposalGeneration,
} from './generation-sources.js';
import { normalizeQueueBinding, type ProposalQueueBinding } from './submission.js';

export const PROPOSAL_GENERATION_RECORD_BYTES = 2 * 1024 * 1024;
export interface PreparedProposalRecord {
  schema_version: 1;
  kind: 'proposal-preparation';
  preparation: PreparedProposalGeneration;
  sha256: string;
}
export interface GeneratedProposalRecord {
  schema_version: 1;
  kind: 'proposal-generation';
  preparation: PreparedProposalRecord;
  provider: Required<ProposalGenerationProvider>;
  generation: GeneratedProposalDraft;
  sha256: string;
}
export type ProposalGenerationRecord = PreparedProposalRecord | GeneratedProposalRecord;
const classes: Classification[] = ['public', 'internal', 'confidential', 'restricted'];

// Used only after syncJsonSnapshot has detached and bounded a finite JSON value.
// Object keys use JavaScript UTF-16 lexical order; array order is significant.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(row)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(row[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value)!;
}
function same(actual: unknown, expected: unknown) {
  if (canonical(actual) !== canonical(expected)) throw new TypeError();
}
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError();
  return row;
}
function timestamp(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new TypeError();
}
function trace(value: unknown, prefix: string) {
  if (typeof value !== 'string' || !value.startsWith(prefix) || !isUlid(value.slice(prefix.length)))
    throw new TypeError();
}
function ascii(value: unknown, maximum: number) {
  if (typeof value !== 'string' || value.length > maximum || !/^[\x21-\x7e]+$/.test(value))
    throw new TypeError();
}
function prettyBound(value: unknown, maximum: number) {
  if (Buffer.byteLength(JSON.stringify(value, null, 2) + '\n', 'utf8') > maximum)
    throw new TypeError();
}
function digest(body: unknown) {
  return createHash('sha256').update(canonical(body), 'utf8').digest('hex');
}
function verifyDigest(row: Record<string, unknown>) {
  const { sha256, ...body } = row;
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) || sha256 !== digest(body))
    throw new TypeError();
}
function preparation(value: unknown): PreparedProposalGeneration {
  const row = object(value, [
    'schema_version',
    'trace_id',
    'prepared_at',
    'binding',
    'selection',
    'observations',
    'input',
  ]);
  if (row.schema_version !== 1) throw new TypeError();
  trace(row.trace_id, 'trace_generation_sources_');
  timestamp(row.prepared_at);
  same(row.binding, normalizeQueueBinding(row.binding as ProposalQueueBinding));
  const selection = parseProposalGenerationSelection(row.selection);
  const input = parseProposalGenerationRequest(row.input);
  same(row.selection, selection);
  same(row.input, input);
  prettyBound(input, 512 * 1024);
  if (
    !Array.isArray(row.observations) ||
    row.observations.length !== selection.sources.length ||
    input.sources.length !== selection.sources.length ||
    input.kind !== selection.kind ||
    input.task !== selection.task ||
    input.ttl_seconds !== selection.ttl_seconds
  )
    throw new TypeError();
  row.observations.forEach((value, index) => {
    const observation = object(value, [
      'item_id',
      'revision',
      'status',
      'classification',
      'checked_at',
      'expires_at',
    ]);
    const selected = selection.sources[index]!;
    const source = input.sources[index]!;
    if (
      observation.item_id !== selected.item_id ||
      observation.revision !== selected.revision ||
      (observation.status !== 'proposed' && observation.status !== 'confirmed') ||
      observation.classification !== source.classification
    )
      throw new TypeError();
    same(source.ref, { type: 'context-item', id: selected.item_id, revision: selected.revision });
    timestamp(observation.checked_at);
    if (observation.expires_at !== null) timestamp(observation.expires_at);
  });
  const classification =
    classes[
      Math.max(
        classes.indexOf(selection.classification),
        ...input.sources.map((source) => classes.indexOf(source.classification)),
      )
    ];
  if (input.classification !== classification) throw new TypeError();
  return row as unknown as PreparedProposalGeneration;
}
function preparedRecord(value: unknown): PreparedProposalRecord {
  const row = object(value, ['schema_version', 'kind', 'preparation', 'sha256']);
  if (row.schema_version !== 1 || row.kind !== 'proposal-preparation') throw new TypeError();
  preparation(row.preparation);
  verifyDigest(row);
  return row as unknown as PreparedProposalRecord;
}
function generatedRecord(value: unknown): GeneratedProposalRecord {
  const row = object(value, [
    'schema_version',
    'kind',
    'preparation',
    'provider',
    'generation',
    'sha256',
  ]);
  if (row.schema_version !== 1 || row.kind !== 'proposal-generation') throw new TypeError();
  const prepared = preparedRecord(row.preparation);
  const provider = parseProposalGenerationProvider(row.provider);
  same(row.provider, provider);
  const result = object(row.generation, [
    'schema_version',
    'trace_id',
    'generated_at',
    'prompt_version',
    'requested_model',
    'returned_model',
    'provider_response_id',
    'source_refs',
    'draft',
  ]);
  const draft = parseCreateProposal(result.draft);
  const input = prepared.preparation.input;
  same(result.draft, draft);
  prettyBound(draft, 1024 * 1024);
  if (
    result.schema_version !== 1 ||
    result.prompt_version !== PROPOSAL_GENERATION_PROMPT ||
    result.requested_model !== provider.model ||
    result.returned_model !== draft.model_version ||
    draft.prompt_version !== PROPOSAL_GENERATION_PROMPT ||
    draft.kind !== input.kind ||
    draft.classification !== input.classification ||
    draft.ttl_seconds !== input.ttl_seconds ||
    draft.derived_from !== undefined ||
    classes.indexOf(input.classification) > classes.indexOf(provider.max_classification)
  )
    throw new TypeError();
  trace(result.trace_id, 'trace_generation_');
  timestamp(result.generated_at);
  ascii(result.returned_model, 200);
  ascii(result.provider_response_id, 255);
  const refs = input.sources.map((source) => source.ref);
  same(result.source_refs, refs);
  same(draft.source_refs, refs);
  verifyDigest(row);
  return row as unknown as GeneratedProposalRecord;
}

/** Offline consistency inspection, not source authentication, permission or freshness proof. */
export function inspectProposalGenerationRecord(value: unknown): ProposalGenerationRecord {
  try {
    const detached: unknown = JSON.parse(syncJsonSnapshot(value, PROPOSAL_GENERATION_RECORD_BYTES));
    prettyBound(detached, PROPOSAL_GENERATION_RECORD_BYTES);
    if (!detached || typeof detached !== 'object' || !('kind' in detached)) throw new TypeError();
    return detached.kind === 'proposal-preparation'
      ? preparedRecord(detached)
      : generatedRecord(detached);
  } catch {
    throw new ContractError(
      'PROPOSAL_GENERATION_RECORD_INVALID',
      'Generation record is incomplete, inconsistent or exceeds its limits',
    );
  }
}
function seal(body: unknown): ProposalGenerationRecord {
  const detached = JSON.parse(syncJsonSnapshot(body, PROPOSAL_GENERATION_RECORD_BYTES)) as Record<
    string,
    unknown
  >;
  return inspectProposalGenerationRecord({ ...detached, sha256: digest(detached) });
}
export function createPreparedProposalRecord(
  prepared: PreparedProposalGeneration,
): PreparedProposalRecord {
  return seal({
    schema_version: 1,
    kind: 'proposal-preparation',
    preparation: prepared,
  }) as PreparedProposalRecord;
}
export function createGeneratedProposalRecord(
  prepared: PreparedProposalRecord,
  provider: ProposalGenerationProvider,
  generation: GeneratedProposalDraft,
): GeneratedProposalRecord {
  return seal({
    schema_version: 1,
    kind: 'proposal-generation',
    preparation: prepared,
    provider: parseProposalGenerationProvider(provider),
    generation,
  }) as GeneratedProposalRecord;
}

/** Fully inspect and bind before callers open any destination queue. */
export function readGeneratedProposalDraft(value: unknown, binding: ProposalQueueBinding) {
  const record = inspectProposalGenerationRecord(value);
  if (record.kind !== 'proposal-generation')
    throw new ContractError(
      'PROPOSAL_GENERATION_RECORD_INVALID',
      'A complete generation record is required',
    );
  const target = normalizeQueueBinding(
    JSON.parse(syncJsonSnapshot(binding, 16 * 1024)) as ProposalQueueBinding,
  );
  if (canonical(record.preparation.preparation.binding) !== canonical(target))
    throw new ContractError(
      'PROPOSAL_GENERATION_BINDING_MISMATCH',
      'The destination must match the original gateway, project and identity',
    );
  return record.generation.draft;
}
