import {
  ContractError,
  parseConflictReceiptQuery,
  CONFLICT_RECEIPT_REQUEST_BYTES,
} from '@planemem/contracts';
import { readBoundedArtifactFile } from './artifact-files.js';

export async function readConflictJsonFile(path: string, trace: string): Promise<unknown> {
  let bytes;
  try {
    bytes = await readBoundedArtifactFile(path, CONFLICT_RECEIPT_REQUEST_BYTES, trace);
  } catch {
    throw new ContractError(
      'CONFLICT_REQUEST_FILE_UNAVAILABLE',
      'Read a stable regular conflict JSON file within 1 MB; no decision was sent',
      {
        trace_id: trace,
        retryable: false,
        dispatch_state: 'not-sent',
        decision_dispatch_state: 'not-sent',
      },
    );
  }
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown;
  } catch {
    throw new ContractError('USAGE_ERROR', 'The conflict file must contain complete UTF-8 JSON', {
      trace_id: trace,
      retryable: false,
      dispatch_state: 'not-sent',
      decision_dispatch_state: 'not-sent',
    });
  }
}

export async function readConflictOriginalFile(
  path: string,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
  trace: string,
) {
  const value = await readConflictJsonFile(path, trace);
  try {
    const original = parseConflictReceiptQuery(value);
    for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (original.identity[field] !== scope[field]) throw new TypeError();
    return original;
  } catch {
    throw new ContractError(
      'USAGE_ERROR',
      'Keep the complete saved identity, request_key and command, and use the original project scope',
      {
        trace_id: trace,
        retryable: false,
        dispatch_state: 'not-sent',
        decision_dispatch_state: 'not-sent',
      },
    );
  }
}
