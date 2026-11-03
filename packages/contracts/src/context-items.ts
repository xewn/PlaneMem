import type { ContextLayer, ContextScope } from './context.js';
import { validateSourceRef, type Classification, type SourceRef } from './metadata.js';

export type ContextItemStatus = 'proposed' | 'confirmed' | 'expired' | 'excluded';
export type ContextItemPriority = 'High' | 'Medium' | 'Low';

export interface ContextItemListQuery {
  query?: string;
  layer?: ContextLayer;
  classification?: Classification;
  status?: ContextItemStatus;
  item_type?: string;
  /** Only archived items when true; active items otherwise. */
  archived?: boolean;
  /** Opaque next_cursor from the same scope and filters. */
  cursor?: string;
  limit?: number;
}

export function parseContextItemListQuery(raw: unknown): ContextItemListQuery {
  const input = record(raw);
  rejectUnknown(input, [
    'query',
    'layer',
    'classification',
    'status',
    'item_type',
    'archived',
    'cursor',
    'limit',
  ]);
  const parsed: ContextItemListQuery = {};
  if (input.archived !== undefined) {
    if (typeof input.archived !== 'boolean') throw new TypeError('archived must be a boolean');
    parsed.archived = input.archived;
  }
  for (const field of ['query', 'layer', 'classification', 'status', 'item_type'] as const) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > 500 || /[\u0000\p{Cs}]/u.test(value))
      throw new TypeError(field + ' must be text of at most 500 characters');
  }
  if (typeof input.query === 'string' && input.query.trim()) parsed.query = input.query.trim();
  if (typeof input.item_type === 'string' && input.item_type.trim())
    parsed.item_type = input.item_type.trim();
  if (input.layer)
    parsed.layer = choice(input.layer, ['L0', 'L1', 'L2', 'L3', 'L4'], 'layer') as ContextLayer;
  if (input.classification)
    parsed.classification = choice(
      input.classification,
      ['public', 'internal', 'confidential', 'restricted'],
      'classification',
    ) as Classification;
  if (input.status)
    parsed.status = choice(
      input.status,
      ['confirmed', 'proposed', 'expired', 'excluded'],
      'status',
    ) as ContextItemStatus;
  if (input.cursor !== undefined) {
    if (typeof input.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(input.cursor))
      throw new TypeError('cursor must be an opaque context list cursor');
    parsed.cursor = input.cursor;
  }
  if (input.limit !== undefined) {
    if (
      typeof input.limit !== 'number' ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    )
      throw new TypeError('limit must be an integer between 1 and 100');
    parsed.limit = input.limit;
  }
  return parsed;
}

export interface CreateContextItemRequest {
  title: string;
  content: string;
  source_refs: SourceRef[];
  item_type?: string;
  layer?: ContextLayer;
  classification?: Classification;
  priority?: ContextItemPriority;
  confidence?: number;
  expires_at?: string | null;
}

/** Editing cannot grant confirmation or change the existing classification. */
export type UpdateContextItemRequest = Partial<Omit<CreateContextItemRequest, 'classification'>> & {
  status?: 'proposed' | 'excluded';
};

export interface ContextItemDocument extends ContextScope {
  id: string;
  title: string;
  content: unknown;
  source_refs: SourceRef[];
  source_ref: string;
  item_type: string;
  layer: ContextLayer;
  classification: Classification;
  status: ContextItemStatus;
  priority: ContextItemPriority;
  confidence: number;
  expires_at: string | null;
  version: number;
  trace_id: string;
  created_at: string;
  updated_at: string;
}

export interface ContextItemConfirmation {
  reviewed_version: number;
  confirmed_version: number;
  actor_id: string;
  client_id: string;
  reason: string;
  confirmed_at: string;
  event_id: string;
}

/** Live read hints are not part of the immutable content snapshot. */
export interface ContextItemReadDocument extends ContextItemDocument {
  confirm_allowed: boolean;
  confirmation: ContextItemConfirmation | null;
  sources_current: boolean;
  source_check: ContextSourceCheck;
  /** Optional live diagnostics for direct local references, indexed into source_refs. */
  source_checks?: ContextSourceReferenceCheck[];
  /** Present for authorized human reviewers of proposed items. Not an approval or reservation. */
  confirmation_readiness?: ContextConfirmationReadiness;
}

export type ContextSourceState =
  | 'current'
  | 'stale'
  | 'unavailable'
  | 'expired'
  | 'excluded'
  | 'cycle'
  | 'limit'
  | 'invalid';
export interface ContextSourceCheck {
  state: ContextSourceState;
  checked_at: string;
  /** External evidence is not fetched or verified by this check. */
  scope: 'local-context-items';
}

export interface ContextSourceReferenceCheck {
  /** Zero-based position in the root item's source_refs; never a hidden descendant identifier. */
  source_index: number;
  state: ContextSourceState | 'not-checked';
  issue?: 'reference' | 'revision' | 'confirmation' | 'classification' | 'dependency';
  /** Present only for a readable, active source with valid metadata. */
  current_revision?: number;
}

export interface ContextConfirmationReadiness {
  /** Strict check requiring all local descendants to be confirmed at their pinned revisions. */
  sources_current: boolean;
  source_check: ContextSourceCheck;
  source_checks?: ContextSourceReferenceCheck[];
  /** Earliest expiry of the root and inspected local dependencies; meaningful only if current. */
  effective_expires_at: string | null;
}

export function parseConfirmContextItem(raw: unknown): { reason: string } {
  const input = record(raw);
  rejectUnknown(input, ['reason']);
  return { reason: boundedText(input.reason, 'reason', 2000).trim() };
}

/** Available only from the explicit archived-item endpoint. */
export interface ArchivedContextItemDocument extends ContextItemDocument {
  archived_at: string;
}

/** A historical command receipt, not the current item state. */
export interface ContextItemMutationReceipt {
  item_id: string;
  operation: 'create' | 'update' | 'archive' | 'restore' | 'confirm';
  version: number;
  event_id: string;
  occurred_at: string;
  replayed: boolean;
}

export interface ContextItemHistoryQuery {
  before_version?: number;
  limit?: number;
}
export interface ContextItemRevisionSummary {
  version: number;
  operation: ContextItemMutationReceipt['operation'] | 'baseline';
  title: string;
  classification: Classification;
  status: ContextItemStatus;
  archived: boolean;
  recorded_at: string;
  actor_id: string | null;
  client_id: string | null;
  event_id: string | null;
  snapshot_hash: string;
}
export interface ContextItemRevision extends ContextItemRevisionSummary {
  item: ContextItemDocument;
  archived_at: string | null;
  confirmation?: ContextItemConfirmation | null;
}
export interface ContextItemHistoryPage {
  item_id: string;
  current_version: number;
  current_archived: boolean;
  versions: ContextItemRevisionSummary[];
  next_before_version?: number;
}

const fields = [
  'title',
  'content',
  'source_refs',
  'item_type',
  'layer',
  'priority',
  'confidence',
  'expires_at',
];

export function parseCreateContextItem(raw: unknown): Required<CreateContextItemRequest> {
  const input = record(raw);
  rejectUnknown(input, [...fields, 'classification']);
  const parsed = parseFields(input);
  if (
    parsed.title === undefined ||
    parsed.content === undefined ||
    parsed.source_refs === undefined
  )
    throw new TypeError('title, content and source_refs are required');
  const classification = choice(
    input.classification === undefined ? 'internal' : input.classification,
    ['public', 'internal', 'confidential', 'restricted'],
    'classification',
  ) as Classification;
  return {
    title: parsed.title,
    content: parsed.content,
    source_refs: parsed.source_refs,
    item_type: parsed.item_type ?? 'note',
    layer: parsed.layer ?? 'L4',
    classification,
    priority: parsed.priority ?? 'Medium',
    confidence: parsed.confidence ?? 0.5,
    expires_at: parsed.expires_at ?? null,
  };
}

export function parseUpdateContextItem(raw: unknown): UpdateContextItemRequest {
  const input = record(raw);
  rejectUnknown(input, [...fields, 'status']);
  if (!Object.keys(input).length) throw new TypeError('Supply at least one field to update');
  const parsed: UpdateContextItemRequest = parseFields(input);
  if (input.status !== undefined)
    parsed.status = choice(input.status, ['proposed', 'excluded'], 'status') as
      | 'proposed'
      | 'excluded';
  if (!Object.keys(parsed).length) throw new TypeError('Supply at least one field to update');
  return parsed;
}

function parseFields(input: Record<string, unknown>): Partial<CreateContextItemRequest> {
  const parsed: Partial<CreateContextItemRequest> = {};
  if (input.title !== undefined) parsed.title = boundedText(input.title, 'title', 300).trim();
  if (input.content !== undefined) parsed.content = boundedText(input.content, 'content', 131072);
  if (input.item_type !== undefined)
    parsed.item_type = boundedText(input.item_type, 'item_type', 64).trim();
  if (input.layer !== undefined)
    parsed.layer = choice(input.layer, ['L0', 'L1', 'L2', 'L3', 'L4'], 'layer') as ContextLayer;
  if (input.priority !== undefined)
    parsed.priority = choice(
      input.priority,
      ['High', 'Medium', 'Low'],
      'priority',
    ) as ContextItemPriority;
  if (input.confidence !== undefined) {
    if (
      typeof input.confidence !== 'number' ||
      !Number.isFinite(input.confidence) ||
      input.confidence < 0 ||
      input.confidence > 1
    )
      throw new TypeError('confidence must be between 0 and 1');
    parsed.confidence = Math.round(input.confidence * 1000) / 1000;
  }
  if (input.expires_at !== undefined) {
    if (input.expires_at === null) parsed.expires_at = null;
    else {
      const value = boundedText(input.expires_at, 'expires_at', 40);
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
        !Number.isFinite(Date.parse(value))
      )
        throw new TypeError('expires_at must be a UTC ISO timestamp ending in Z or null');
      const normalized = new Date(value).toISOString();
      if (normalized.slice(0, 19) !== value.slice(0, 19))
        throw new TypeError('expires_at is not a valid calendar timestamp');
      parsed.expires_at = normalized;
    }
  }
  if (input.source_refs !== undefined) {
    if (
      !Array.isArray(input.source_refs) ||
      input.source_refs.length < 1 ||
      input.source_refs.length > 32
    )
      throw new TypeError('Supply between 1 and 32 source references');
    parsed.source_refs = input.source_refs.map((raw) => {
      const ref = record(raw);
      rejectUnknown(ref, ['type', 'id', 'revision', 'uri']);
      const source = validateSourceRef(ref);
      boundedText(source.type, 'source_ref.type', 64);
      boundedText(source.id, 'source_ref.id', 255);
      if (source.uri !== undefined) boundedText(source.uri, 'source_ref.uri', 2048);
      return {
        type: source.type,
        id: source.id,
        ...(source.revision === undefined ? {} : { revision: source.revision }),
        ...(source.uri === undefined ? {} : { uri: source.uri }),
      };
    });
  }
  return parsed;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected an object');
  return value as Record<string, unknown>;
}
function rejectUnknown(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new TypeError('Unknown context item field');
}
function choice(value: unknown, allowed: string[], name: string): string {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new TypeError('Invalid ' + name);
  return value;
}
function boundedText(value: unknown, name: string, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000\p{Cs}]/u.test(value)
  )
    throw new TypeError(name + ' must be non-empty text of at most ' + max + ' characters');
  return value;
}
