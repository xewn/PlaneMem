import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  ContractError,
  createUlid,
  isUlid,
  syncJsonSnapshot,
  validateIdempotencyKey,
} from '@planemem/contracts';
import { parseProposalGenerationProvider, type ProposalGenerationProvider } from './generation.js';
import {
  inspectProposalGenerationRecord,
  type PreparedProposalRecord,
  type GeneratedProposalRecord,
} from './generation-record.js';
import { normalizeQueueBinding, type ProposalQueueBinding } from './queue-binding.js';

export const GENERATION_REQUEST_BYTES = 3 * 1024 * 1024;
export interface ProposalGenerationRequestRecord {
  schema_version: 1;
  kind: 'proposal-generation-request';
  request_id: string;
  request_key: string;
  created_at: string;
  preparation: PreparedProposalRecord;
  provider: Required<ProposalGenerationProvider>;
  sha256: string;
}
export interface ProposalGenerationAttempt {
  schema_version: 1;
  kind: 'proposal-generation-attempt';
  request_id: string;
  request_sha256: string;
  attempt_id: string;
  started_at: string;
  sha256: string;
}
export interface ProposalGenerationFailure {
  code: string;
  trace_id: string | null;
  provider_dispatch: 'attempted' | 'not-sent' | 'unknown';
}
export interface ProposalGenerationOutcome {
  schema_version: 1;
  kind: 'proposal-generation-outcome';
  request_id: string;
  request_sha256: string;
  attempt_id: string;
  finished_at: string;
  record: GeneratedProposalRecord | null;
  failure: ProposalGenerationFailure | null;
  sha256: string;
}
export interface ProposalGenerationRequestState {
  request: ProposalGenerationRequestRecord;
  attempt: ProposalGenerationAttempt | null;
  outcome: ProposalGenerationOutcome | null;
  state: 'prepared' | 'attempted' | 'generated' | 'failed';
}
const classes = ['public', 'internal', 'confidential', 'restricted'];
export function validateGenerationRequestKey(value: unknown): asserts value is string {
  validateIdempotencyKey(value);
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(value))
    throw new TypeError('Use a visible ASCII request key');
}
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
function digest(value: unknown) {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}
function object(value: unknown, fields: string[]): Record<string, unknown> {
  const row: unknown = JSON.parse(syncJsonSnapshot(value, GENERATION_REQUEST_BYTES));
  if (
    !row ||
    typeof row !== 'object' ||
    Array.isArray(row) ||
    Object.keys(row).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(row, field)) ||
    Buffer.byteLength(JSON.stringify(row, null, 2) + '\n', 'utf8') > GENERATION_REQUEST_BYTES
  )
    throw new TypeError();
  return row as Record<string, unknown>;
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
function checksum(row: Record<string, unknown>) {
  const { sha256, ...body } = row;
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) || sha256 !== digest(body))
    throw new TypeError();
}
function seal(body: unknown) {
  const row = JSON.parse(syncJsonSnapshot(body, GENERATION_REQUEST_BYTES)) as Record<
    string,
    unknown
  >;
  return { ...row, sha256: digest(row) };
}
export function inspectGenerationRequest(
  value: unknown,
  binding: ProposalQueueBinding,
  key: string,
): ProposalGenerationRequestRecord {
  validateGenerationRequestKey(key);
  const row = object(value, [
    'schema_version',
    'kind',
    'request_id',
    'request_key',
    'created_at',
    'preparation',
    'provider',
    'sha256',
  ]);
  if (
    row.schema_version !== 1 ||
    row.kind !== 'proposal-generation-request' ||
    !isUlid(row.request_id) ||
    row.request_key !== key
  )
    throw new TypeError();
  timestamp(row.created_at);
  const prepared = inspectProposalGenerationRecord(row.preparation);
  const provider = parseProposalGenerationProvider(row.provider);
  if (
    prepared.kind !== 'proposal-preparation' ||
    !isDeepStrictEqual(provider, row.provider) ||
    classes.indexOf(prepared.preparation.input.classification) >
      classes.indexOf(provider.max_classification)
  )
    throw new TypeError();
  if (!isDeepStrictEqual(prepared.preparation.binding, normalizeQueueBinding(binding)))
    throw new ContractError(
      'PROPOSAL_GENERATION_BINDING_MISMATCH',
      'The request belongs to another gateway, project or identity',
    );
  checksum(row);
  return row as unknown as ProposalGenerationRequestRecord;
}
export function createGenerationRequest(
  preparation: unknown,
  provider: unknown,
  binding: ProposalQueueBinding,
  key: string,
) {
  return inspectGenerationRequest(
    seal({
      schema_version: 1,
      kind: 'proposal-generation-request',
      request_id: createUlid(),
      request_key: key,
      created_at: new Date().toISOString(),
      preparation: inspectProposalGenerationRecord(preparation),
      provider: parseProposalGenerationProvider(provider),
    }),
    binding,
    key,
  );
}
export function inspectGenerationAttempt(
  value: unknown,
  request: ProposalGenerationRequestRecord,
): ProposalGenerationAttempt {
  const row = object(value, [
    'schema_version',
    'kind',
    'request_id',
    'request_sha256',
    'attempt_id',
    'started_at',
    'sha256',
  ]);
  if (
    row.schema_version !== 1 ||
    row.kind !== 'proposal-generation-attempt' ||
    row.request_id !== request.request_id ||
    row.request_sha256 !== request.sha256 ||
    !isUlid(row.attempt_id)
  )
    throw new TypeError();
  timestamp(row.started_at);
  checksum(row);
  return row as unknown as ProposalGenerationAttempt;
}
export function createGenerationAttempt(request: ProposalGenerationRequestRecord) {
  return inspectGenerationAttempt(
    seal({
      schema_version: 1,
      kind: 'proposal-generation-attempt',
      request_id: request.request_id,
      request_sha256: request.sha256,
      attempt_id: createUlid(),
      started_at: new Date().toISOString(),
    }),
    request,
  );
}
export function inspectGenerationOutcome(
  value: unknown,
  request: ProposalGenerationRequestRecord,
  attempt: ProposalGenerationAttempt,
): ProposalGenerationOutcome {
  inspectGenerationAttempt(attempt, request);
  const row = object(value, [
    'schema_version',
    'kind',
    'request_id',
    'request_sha256',
    'attempt_id',
    'finished_at',
    'record',
    'failure',
    'sha256',
  ]);
  if (
    row.schema_version !== 1 ||
    row.kind !== 'proposal-generation-outcome' ||
    row.request_id !== request.request_id ||
    row.request_sha256 !== request.sha256 ||
    row.attempt_id !== attempt.attempt_id
  )
    throw new TypeError();
  timestamp(row.finished_at);
  if (row.record !== null) {
    const record = inspectProposalGenerationRecord(row.record);
    if (
      row.failure !== null ||
      record.kind !== 'proposal-generation' ||
      !isDeepStrictEqual(record.preparation, request.preparation) ||
      !isDeepStrictEqual(record.provider, request.provider)
    )
      throw new TypeError();
  } else {
    const failure = object(row.failure, ['code', 'trace_id', 'provider_dispatch']);
    if (
      typeof failure.code !== 'string' ||
      !/^[A-Z][A-Z0-9_]{1,127}$/.test(failure.code) ||
      !['attempted', 'not-sent', 'unknown'].includes(failure.provider_dispatch as string) ||
      (failure.trace_id !== null &&
        (typeof failure.trace_id !== 'string' ||
          !failure.trace_id.startsWith('trace_generation_') ||
          !isUlid(failure.trace_id.slice('trace_generation_'.length))))
    )
      throw new TypeError();
  }
  checksum(row);
  return row as unknown as ProposalGenerationOutcome;
}
export function createGenerationOutcome(
  request: ProposalGenerationRequestRecord,
  attempt: ProposalGenerationAttempt,
  record: GeneratedProposalRecord | null,
  failure: ProposalGenerationFailure | null,
) {
  return inspectGenerationOutcome(
    seal({
      schema_version: 1,
      kind: 'proposal-generation-outcome',
      request_id: request.request_id,
      request_sha256: request.sha256,
      attempt_id: attempt.attempt_id,
      finished_at: new Date().toISOString(),
      record,
      failure,
    }),
    request,
    attempt,
  );
}
export function generationRequestSummary(value: ProposalGenerationRequestState) {
  return {
    state: value.state,
    request_id: value.request.request_id,
    request_key: value.request.request_key,
    request_sha256: value.request.sha256,
    created_at: value.request.created_at,
    preparation_sha256: value.request.preparation.sha256,
    binding: value.request.preparation.preparation.binding,
    provider: value.request.provider,
    attempt_id: value.attempt?.attempt_id ?? null,
    started_at: value.attempt?.started_at ?? null,
    finished_at: value.outcome?.finished_at ?? null,
    record_sha256: value.outcome?.record?.sha256 ?? null,
    failure: value.outcome?.failure ?? null,
  };
}
