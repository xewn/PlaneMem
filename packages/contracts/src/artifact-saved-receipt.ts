import {
  parseArtifactReceiptEnvelope,
  parseArtifactReceiptQuery,
  type ArtifactReceiptEnvelope,
  type ArtifactReceiptQuery,
} from './artifact-receipt.js';
import { ARTIFACT_UPLOAD_REQUEST_BYTES } from './artifact-upload.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';

export const ARTIFACT_SAVED_RECEIPT_BYTES = 4 * 1024 * 1024;

export interface ParsedSavedArtifactReceipt {
  receipt: ArtifactReceiptEnvelope;
  original: ArtifactReceiptQuery;
  receipt_json: string;
  original_json: string;
}

/** Parse an existing bare receipt envelope. Local validity never authenticates its origin. */
export function parseSavedArtifactReceipt(value: unknown): ParsedSavedArtifactReceipt {
  const row = JSON.parse(syncJsonSnapshot(value, ARTIFACT_SAVED_RECEIPT_BYTES)) as Record<
    string,
    unknown
  >;
  if (
    !row ||
    typeof row !== 'object' ||
    Array.isArray(row) ||
    typeof row.trace_id !== 'string' ||
    !row.data ||
    typeof row.data !== 'object' ||
    Array.isArray(row.data)
  )
    throw new TypeError('Expected a complete saved artifact receipt');
  const data = row.data as Record<string, unknown>;
  const original = parseArtifactReceiptQuery(
    JSON.parse(
      syncJsonSnapshot(
        { identity: data.identity, command: data.command },
        ARTIFACT_UPLOAD_REQUEST_BYTES,
      ),
    ),
  );
  const receipt = parseArtifactReceiptEnvelope(row, original, row.trace_id);
  return {
    receipt,
    original,
    receipt_json: syncJsonSnapshot(receipt, ARTIFACT_SAVED_RECEIPT_BYTES),
    original_json: syncJsonSnapshot(original, ARTIFACT_UPLOAD_REQUEST_BYTES),
  };
}
