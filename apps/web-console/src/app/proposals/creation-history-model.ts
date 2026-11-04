import {
  buildEtag,
  isUlid,
  parseProposalCreateReceiptEnvelope,
  proposalReceiptJson,
  syncJsonSnapshot,
  type ProposalCreateReceiptEnvelope,
  type ProposalMutationReceipt,
} from '@planemem/contracts';
import { parseProposalOriginal, type ProposalOriginal } from './original-model';

export const CREATION_SUBMISSION_RECEIPT_BYTES = 64 * 1024;
export const CREATION_OBSERVATION_BYTES = 4 * 1024 * 1024;
export const CREATION_HISTORY_FILE_BYTES = CREATION_OBSERVATION_BYTES + 1024;
export interface CreationSubmissionReceipt {
  schema_version: 1;
  trace_id: string;
  data: ProposalMutationReceipt & { status: 'proposed'; revision: 1 };
  source_refs: Array<{ type: 'proposal'; id: string; revision: 1 }>;
  revision: 1;
  etag: string;
  server_cursor: number;
}
export type CreationObservation = {
  schema_version: 1;
  kind: 'proposal-creation-observation';
  original: ProposalOriginal;
  observed_at: string;
} & (
  | { source: 'submission'; receipt: CreationSubmissionReceipt }
  | { source: 'receipt-query'; receipt: ProposalCreateReceiptEnvelope }
);
export interface CreationHistoryFile {
  document: CreationObservation;
  document_sha256: string;
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(row, field))
  )
    throw new TypeError();
  return row;
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
/** Validate the full creation response; a file is still not authenticated server evidence. */
export function parseCreationSubmissionReceipt(
  value: unknown,
  trace: string,
): CreationSubmissionReceipt {
  const row = object(JSON.parse(syncJsonSnapshot(value, CREATION_SUBMISSION_RECEIPT_BYTES)), [
    'schema_version',
    'trace_id',
    'data',
    'source_refs',
    'revision',
    'etag',
    'server_cursor',
  ]);
  const data = object(row.data, [
    'proposal_id',
    'status',
    'revision',
    'event_id',
    'occurred_at',
    'replayed',
  ]);
  if (
    row.schema_version !== 1 ||
    typeof trace !== 'string' ||
    !/^[\x21-\x7e]{1,255}$/.test(trace) ||
    row.trace_id !== trace ||
    row.revision !== 1 ||
    row.etag !== buildEtag(1) ||
    typeof row.server_cursor !== 'number' ||
    !Number.isSafeInteger(row.server_cursor) ||
    row.server_cursor < 1 ||
    !isUlid(data.proposal_id) ||
    data.status !== 'proposed' ||
    data.revision !== 1 ||
    !isUlid(data.event_id) ||
    !timestamp(data.occurred_at) ||
    typeof data.replayed !== 'boolean' ||
    !Array.isArray(row.source_refs) ||
    row.source_refs.length !== 1
  )
    throw new TypeError();
  const source = object(row.source_refs[0], ['type', 'id', 'revision']);
  if (source.type !== 'proposal' || source.id !== data.proposal_id || source.revision !== 1)
    throw new TypeError();
  return row as unknown as CreationSubmissionReceipt;
}
export function parseCreationObservation(value: unknown): CreationObservation {
  const row = object(JSON.parse(syncJsonSnapshot(value, CREATION_OBSERVATION_BYTES)), [
    'schema_version',
    'kind',
    'original',
    'observed_at',
    'source',
    'receipt',
  ]);
  if (
    row.schema_version !== 1 ||
    row.kind !== 'proposal-creation-observation' ||
    !timestamp(row.observed_at)
  )
    throw new TypeError();
  const original = parseProposalOriginal(row.original);
  const trace = (row.receipt as Record<string, unknown> | null)?.trace_id;
  if (typeof trace !== 'string') throw new TypeError();
  const base = {
    schema_version: 1 as const,
    kind: 'proposal-creation-observation' as const,
    original,
    observed_at: row.observed_at,
  };
  let result: CreationObservation;
  if (row.source === 'submission')
    result = {
      ...base,
      source: 'submission',
      receipt: parseCreationSubmissionReceipt(row.receipt, trace),
    };
  else if (row.source === 'receipt-query')
    result = {
      ...base,
      source: 'receipt-query',
      receipt: parseProposalCreateReceiptEnvelope(
        row.receipt,
        {
          identity: original.binding.identity,
          request_key: original.request_key,
          draft: original.draft,
        },
        trace,
      ),
    };
  else throw new TypeError();
  // No field may be discarded or normalized out of a retained response or original request.
  if (
    proposalReceiptJson(result, CREATION_OBSERVATION_BYTES) !==
    proposalReceiptJson(row, CREATION_OBSERVATION_BYTES)
  )
    throw new TypeError();
  return result;
}
export function creationObservationJson(value: unknown) {
  return proposalReceiptJson(parseCreationObservation(value), CREATION_OBSERVATION_BYTES);
}
export function parseCreationHistoryFile(value: unknown): CreationHistoryFile {
  const row = object(JSON.parse(syncJsonSnapshot(value, CREATION_HISTORY_FILE_BYTES)), [
    'document',
    'document_sha256',
  ]);
  if (typeof row.document_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.document_sha256))
    throw new TypeError();
  return { document: parseCreationObservation(row.document), document_sha256: row.document_sha256 };
}
export function creationHistoryFileJson(value: unknown) {
  return proposalReceiptJson(parseCreationHistoryFile(value), CREATION_HISTORY_FILE_BYTES);
}
export function creationObservationStatus(document: CreationObservation) {
  return document.source === 'submission' ? 'recorded' : document.receipt.data.status;
}
/** Stable creation facts only; a fresh query trace or replay flag does not change the old event. */
export function creationRecordedReceipt(document: CreationObservation) {
  const receipt =
    document.source === 'submission'
      ? { ...document.receipt.data, server_cursor: document.receipt.server_cursor }
      : document.receipt.data.status === 'recorded'
        ? document.receipt.data.receipt
        : undefined;
  if (!receipt) return undefined;
  return {
    proposal_id: receipt.proposal_id,
    status: receipt.status,
    revision: receipt.revision,
    event_id: receipt.event_id,
    occurred_at: receipt.occurred_at,
    server_cursor: receipt.server_cursor,
  };
}
