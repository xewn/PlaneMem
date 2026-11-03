import {
  isUlid,
  parseCreateProposal,
  proposalKinds,
  proposalReceiptJson,
  syncJsonSnapshot,
  validateIdempotencyKey,
} from '@planemem/contracts';
import { parseProposalSubmissionBinding, type ProposalSubmissionBinding } from './original-model';

export const PROPOSAL_EDITING_BYTES = 1024 * 1024;
export interface ProposalEditingFields {
  values: {
    kind: string;
    title: string;
    content: string;
    model_version: string;
    prompt_version: string;
    classification: string;
    ttl_seconds: string;
  };
  sources: Array<{ type: string; id: string; revision: string; uri: string }>;
  origin: { proposal_id: string; revision: string } | null;
}
export interface ProposalEditingDraft {
  schema_version: 1;
  kind: 'proposal-editing-draft';
  binding: ProposalSubmissionBinding;
  request_key: string;
  saved_at: string;
  fields: ProposalEditingFields;
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError();
  return row;
}
function text(value: unknown, maximum: number) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000\p{Cs}]/u.test(value))
    throw new TypeError();
}
export function encodeProposalEditingDraft(value: unknown) {
  return proposalReceiptJson(parseProposalEditingDraft(value), PROPOSAL_EDITING_BYTES);
}
export function parseProposalEditingDraft(value: unknown): ProposalEditingDraft {
  const row = object(JSON.parse(syncJsonSnapshot(value, PROPOSAL_EDITING_BYTES)), [
    'schema_version',
    'kind',
    'binding',
    'request_key',
    'saved_at',
    'fields',
  ]);
  if (
    row.schema_version !== 1 ||
    row.kind !== 'proposal-editing-draft' ||
    typeof row.saved_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.saved_at) ||
    !Number.isFinite(Date.parse(row.saved_at)) ||
    new Date(row.saved_at).toISOString() !== row.saved_at
  )
    throw new TypeError();
  const binding = parseProposalSubmissionBinding(row.binding);
  if (proposalReceiptJson(binding) !== proposalReceiptJson(row.binding)) throw new TypeError();
  const key = validateIdempotencyKey(row.request_key);
  if (!/^[\x21-\x7e]{1,255}$/.test(key)) throw new TypeError();
  const fields = object(row.fields, ['values', 'sources', 'origin']);
  const values = object(fields.values, [
    'kind',
    'title',
    'content',
    'model_version',
    'prompt_version',
    'classification',
    'ttl_seconds',
  ]);
  for (const [field, maximum] of Object.entries({
    kind: 64,
    title: 300,
    content: 131072,
    model_version: 200,
    prompt_version: 200,
    classification: 32,
    ttl_seconds: 32,
  }))
    text(values[field], maximum);
  if (
    !(proposalKinds as readonly string[]).includes(values.kind as string) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(values.classification as string)
  )
    throw new TypeError();
  if (!Array.isArray(fields.sources) || fields.sources.length < 1 || fields.sources.length > 32)
    throw new TypeError();
  for (const item of fields.sources) {
    const source = object(item, ['type', 'id', 'revision', 'uri']);
    for (const [field, maximum] of Object.entries({ type: 64, id: 255, revision: 32, uri: 2048 }))
      text(source[field], maximum);
  }
  if (fields.origin !== null) {
    const origin = object(fields.origin, ['proposal_id', 'revision']);
    if (!isUlid(origin.proposal_id)) throw new TypeError();
    text(origin.revision, 32);
  }
  if (new TextEncoder().encode(JSON.stringify(row, null, 2)).byteLength > PROPOSAL_EDITING_BYTES)
    throw new TypeError();
  return row as unknown as ProposalEditingDraft;
}
export function decodeProposalEditingDraft(raw: string) {
  if (
    typeof raw !== 'string' ||
    raw.length > PROPOSAL_EDITING_BYTES ||
    new TextEncoder().encode(raw).byteLength > PROPOSAL_EDITING_BYTES
  )
    throw new TypeError();
  return parseProposalEditingDraft(JSON.parse(raw));
}
export function proposalEditingInput(fields: ProposalEditingFields) {
  return {
    ...fields.values,
    ttl_seconds: Number(fields.values.ttl_seconds),
    source_refs: fields.sources.map(({ type, id, revision, uri }) => ({
      type: type.trim(),
      id: id.trim(),
      ...(revision.trim() ? { revision: Number(revision) } : {}),
      ...(uri.trim() ? { uri: uri.trim() } : {}),
    })),
    ...(fields.origin
      ? {
          derived_from: {
            proposal_id: fields.origin.proposal_id,
            revision: Number(fields.origin.revision),
          },
        }
      : {}),
  };
}
/** Only preparation requires valid complete fields; saving preserves incomplete raw text. */
export function proposalEditingCommand(fields: ProposalEditingFields) {
  return parseCreateProposal(proposalEditingInput(fields));
}
