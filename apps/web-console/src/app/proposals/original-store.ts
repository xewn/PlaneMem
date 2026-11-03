'use client';

import { proposalKinds, type Classification, type ProposalKind } from '@planemem/contracts';
import { inBrowserStores, readBrowserPair } from '../sync/receipt/browser-store';
import {
  assertProposalSubmissionBinding,
  decodeProposalOriginal,
  encodeProposalOriginal,
  parseProposalSubmissionBinding,
  proposalOriginalStorageKey,
  proposalOriginalStoragePrefix,
  PROPOSAL_ORIGINAL_BYTES,
  type ProposalOriginal,
  type ProposalSubmissionBinding,
} from './original-model';

const database = { databaseName: 'planemem-proposal-originals', contentStore: 'originals' };
const keyBytes = 16 * 1024;
const metadataBytes = 4 * 1024;
const pageSize = 20;

interface OriginalMetadata {
  schema_version: 1;
  request_key: string;
  title: string;
  kind: ProposalKind;
  classification: Classification;
  original_bytes: number;
}
export interface SavedProposalOriginal {
  key: string;
  metadata: OriginalMetadata;
}
export interface SavedProposalOriginalPage {
  entries: SavedProposalOriginal[];
  next: string | null;
}
function unavailable() {
  return new Error('The browser original could not be confirmed. Keep every original copy.');
}
function bytes(raw: string) {
  return new TextEncoder().encode(raw).byteLength;
}
function checkedKey(value: unknown, binding: ProposalSubmissionBinding) {
  const prefix = proposalOriginalStoragePrefix(binding);
  if (
    typeof value !== 'string' ||
    value.length > keyBytes ||
    bytes(value) > keyBytes ||
    !value.startsWith(prefix) ||
    !value.endsWith(']')
  )
    throw unavailable();
  const key: unknown = JSON.parse(value.slice(prefix.length, -1));
  if (typeof key !== 'string' || proposalOriginalStorageKey(binding, key) !== value)
    throw unavailable();
  return value;
}
function metadata(original: ProposalOriginal, raw: string): OriginalMetadata {
  return {
    schema_version: 1,
    request_key: original.request_key,
    title: original.draft.title,
    kind: original.draft.kind,
    classification: original.draft.classification,
    original_bytes: bytes(raw),
  };
}
function readMetadata(
  raw: unknown,
  key: unknown,
  binding: ProposalSubmissionBinding,
): SavedProposalOriginal {
  const checked = checkedKey(key, binding);
  if (typeof raw !== 'string' || raw.length > metadataBytes || bytes(raw) > metadataBytes)
    throw unavailable();
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  const row = value as Record<string, unknown>;
  const fields = [
    'schema_version',
    'request_key',
    'title',
    'kind',
    'classification',
    'original_bytes',
  ];
  if (
    Object.keys(row).length !== fields.length ||
    Object.keys(row).some((key) => !fields.includes(key)) ||
    row.schema_version !== 1 ||
    typeof row.request_key !== 'string' ||
    typeof row.title !== 'string' ||
    !row.title.trim() ||
    row.title !== row.title.trim() ||
    row.title.length > 300 ||
    /[\u0000\p{Cs}]/u.test(row.title) ||
    !proposalKinds.includes(row.kind as ProposalKind) ||
    !['public', 'internal', 'confidential', 'restricted'].includes(row.classification as string) ||
    typeof row.original_bytes !== 'number' ||
    !Number.isSafeInteger(row.original_bytes) ||
    row.original_bytes < 1 ||
    row.original_bytes > PROPOSAL_ORIGINAL_BYTES ||
    proposalOriginalStorageKey(binding, row.request_key) !== checked
  )
    throw unavailable();
  return {
    key: checked,
    metadata: {
      schema_version: 1,
      request_key: row.request_key,
      title: row.title,
      kind: row.kind as ProposalKind,
      classification: row.classification as Classification,
      original_bytes: row.original_bytes,
    },
  };
}
function readOriginal(
  raw: unknown,
  summary: unknown,
  key: string,
  binding: ProposalSubmissionBinding,
) {
  const entry = readMetadata(summary, key, binding);
  const original = decodeProposalOriginal(raw);
  const encoded = encodeProposalOriginal(original);
  assertProposalSubmissionBinding(original.binding, binding);
  if (
    encoded !== raw ||
    proposalOriginalStorageKey(binding, original.request_key) !== key ||
    JSON.stringify(metadata(original, encoded)) !== JSON.stringify(entry.metadata)
  )
    throw unavailable();
  return original;
}

/** Reading an old exact slot never migrates, overwrites or deletes it. */
export function loadLegacyProposalOriginal(binding: ProposalSubmissionBinding, requestKey: string) {
  const key = proposalOriginalStorageKey(binding, requestKey);
  const raw = sessionStorage.getItem(key);
  if (raw === null) return null;
  const original = decodeProposalOriginal(raw);
  assertProposalSubmissionBinding(original.binding, binding);
  if (original.request_key !== requestKey) throw unavailable();
  return original;
}
function checkLegacy(original: ProposalOriginal, raw: string) {
  const legacy = loadLegacyProposalOriginal(original.binding, original.request_key);
  if (legacy && encodeProposalOriginal(legacy) !== raw) throw unavailable();
}

/** Never replace either slot. Cross-tab saves serialize; resolve only after committed read-back. */
export async function preserveBrowserProposalOriginal(
  input: ProposalOriginal,
  signal: AbortSignal,
) {
  const raw = encodeProposalOriginal(input);
  const original = decodeProposalOriginal(raw);
  const key = proposalOriginalStorageKey(original.binding, original.request_key);
  const summary = JSON.stringify(metadata(original, raw));
  readMetadata(summary, key, original.binding);
  checkLegacy(original, raw);
  await inBrowserStores<void>(
    database,
    'readwrite',
    signal,
    () => {
      throw unavailable();
    },
    (context) => {
      readBrowserPair(context, key, (existing, index, present) => {
        checkLegacy(original, raw);
        if (present) {
          if (encodeProposalOriginal(readOriginal(existing, index, key, original.binding)) !== raw)
            throw unavailable();
          context.accept(undefined);
          return;
        }
        context.content.add(raw, key);
        context.directory.add(summary, key);
        readBrowserPair(context, key, (saved, savedIndex, exists) => {
          if (
            !exists ||
            encodeProposalOriginal(readOriginal(saved, savedIndex, key, original.binding)) !== raw
          )
            throw unavailable();
          context.accept(undefined);
        });
      });
    },
  );
  if (signal.aborted) throw unavailable();
  checkLegacy(original, raw);
}

/** A selected directory row must still describe the complete original when it is opened. */
export function loadBrowserProposalOriginal(
  input: ProposalSubmissionBinding,
  requestKey: string,
  signal: AbortSignal,
  selection?: SavedProposalOriginal,
) {
  const binding = parseProposalSubmissionBinding(input);
  const key = checkedKey(proposalOriginalStorageKey(binding, requestKey), binding);
  const selected =
    selection === undefined
      ? undefined
      : readMetadata(JSON.stringify(selection.metadata), selection.key, binding);
  if (selected && selected.key !== key) throw unavailable();
  return inBrowserStores<ProposalOriginal | null>(
    database,
    'readonly',
    signal,
    () => null,
    (context) => {
      readBrowserPair(context, key, (raw, summary, present) => {
        if (!present) {
          context.accept(null);
          return;
        }
        const original = readOriginal(raw, summary, key, binding);
        if (
          selected &&
          JSON.stringify(metadata(original, encodeProposalOriginal(original))) !==
            JSON.stringify(selected.metadata)
        )
          throw unavailable();
        context.accept(original);
      });
    },
  );
}

/** Metadata-only, scope-bound keyset page; no full-content or remote-outcome claim. */
export function listBrowserProposalOriginals(
  input: ProposalSubmissionBinding,
  after: string | null,
  signal: AbortSignal,
) {
  const binding = parseProposalSubmissionBinding(input);
  const prefix = proposalOriginalStoragePrefix(binding);
  // Bound even empty-directory queries before touching browser storage.
  checkedKey(proposalOriginalStorageKey(binding, 'a'), binding);
  if (after !== null) checkedKey(after, binding);
  return inBrowserStores<SavedProposalOriginalPage>(
    database,
    'readonly',
    signal,
    () => ({ entries: [], next: null }),
    (context) => {
      const entries: SavedProposalOriginal[] = [];
      const range = IDBKeyRange.bound(after ?? prefix, prefix + '\uffff', after !== null, true);
      const request = context.directory.openCursor(range);
      request.onsuccess = context.guard(() => {
        const cursor = request.result;
        if (!cursor) {
          context.accept({ entries, next: null });
          return;
        }
        const entry = readMetadata(cursor.value as unknown, cursor.primaryKey, binding);
        if (entries.length === pageSize) {
          context.accept({ entries, next: entries[entries.length - 1]!.key });
          return;
        }
        entries.push(entry);
        cursor.continue();
      });
    },
  );
}
