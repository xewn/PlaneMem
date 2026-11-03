import { validateSourceRef, type Classification, type SourceRef } from './metadata.js';

export const syncClassifications: readonly Classification[] = ['public', 'internal', 'confidential', 'restricted'];
export const MAX_SYNC_BATCH_BYTES = 1024 * 1024;

export function isSyncIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 255 &&
    !/[\u0000-\u001f\p{Cs}]/u.test(value);
}

export interface SyncUploadEvent {
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  source_refs: SourceRef[];
  sensitivity?: Classification;
  client_cursor?: number;
}

export function parseSyncUploadEvent(raw: Record<string, unknown>): SyncUploadEvent | undefined {
  if (
    !isSyncIdentifier(raw.event_id) ||
    !isSyncIdentifier(raw.event_type) ||
    (typeof raw.payload !== 'object' || raw.payload === null || Array.isArray(raw.payload))
  )
    return;
  if (
    raw.client_cursor !== undefined &&
    (typeof raw.client_cursor !== 'number' ||
      !Number.isSafeInteger(raw.client_cursor) ||
      raw.client_cursor < 1)
  )
    return;
  const sensitivity = raw.sensitivity ?? 'internal';
  if (!syncClassifications.includes(sensitivity as Classification)) return;
  const refs = raw.source_refs ?? [];
  if (!Array.isArray(refs)) return;
  try {
    // PostgreSQL jsonb cannot represent NULs or unpaired UTF-16 surrogates.
    JSON.stringify(raw, (key, value: unknown) => {
      if (
        /[\u0000\p{Cs}]/u.test(key) ||
        (typeof value === 'string' && /[\u0000\p{Cs}]/u.test(value)) ||
        (typeof value === 'number' && !Number.isFinite(value))
      )
        throw new TypeError();
      return value;
    });
    return {
      event_id: raw.event_id,
      event_type: raw.event_type,
      payload: raw.payload as Record<string, unknown>,
      source_refs: refs.map(validateSourceRef),
      sensitivity: sensitivity as Classification,
      ...(raw.client_cursor === undefined ? {} : { client_cursor: raw.client_cursor }),
    };
  } catch {
    return;
  }
}

/** A proposed change to a projected field. The observed version comes from the server. */
export interface ProposedFieldChange extends Record<string, unknown> {
  entity_type: 'work_item' | 'context_item' | 'session';
  entity_id: string;
  field: string;
  base_version: number;
  value: unknown;
}

export interface AcceptedUpload {
  event_id: string;
  accepted: true;
  server_event_id: string;
  server_cursor: number;
}

export interface RejectedUpload {
  event_id: string;
  accepted: false;
  code:
    | 'VALIDATION_ERROR'
    | 'EVENT_ID_REUSED'
    | 'CURSOR_GAP'
    | 'SOURCE_UNAVAILABLE'
    | 'VERSION_CONFLICT';
  trace_id: string;
  expected_cursor?: number;
  conflict_id?: string;
  server_event_id?: string;
  server_cursor?: number;
}

export interface SyncUploadResult {
  accepted: AcceptedUpload[];
  rejected: RejectedUpload[];
  next_cursor: number;
}
