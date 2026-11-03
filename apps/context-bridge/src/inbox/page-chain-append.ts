import {
  ContractError,
  parseSyncCommandIdentity,
  syncJsonSnapshot,
  type SyncCommandIdentity,
} from '@planemem/contracts';

export interface SyncInboxPageChainAppendQuery {
  expected_identity: SyncCommandIdentity;
  archive_document_sha256: string;
  expected_head_sha256: string | null;
  expected_page_count: number;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError();
  return value;
}
export function parseInboxPageChainAppendQuery(
  value: unknown,
  trace: string,
): SyncInboxPageChainAppendQuery {
  try {
    const snapshot: unknown = JSON.parse(syncJsonSnapshot(value, 16384));
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new TypeError();
    const input = snapshot as Record<string, unknown>;
    const fields = [
      'expected_identity',
      'archive_document_sha256',
      'expected_head_sha256',
      'expected_page_count',
    ];
    if (
      Object.keys(input).length !== fields.length ||
      Object.keys(input).some((key) => !fields.includes(key))
    )
      throw new TypeError();
    const count = input.expected_page_count;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
      throw new TypeError();
    const head = input.expected_head_sha256 === null ? null : digest(input.expected_head_sha256);
    if ((count === 0) !== (head === null)) throw new TypeError();
    return {
      expected_identity: parseSyncCommandIdentity(input.expected_identity),
      archive_document_sha256: digest(input.archive_document_sha256),
      expected_head_sha256: head,
      expected_page_count: count,
    };
  } catch {
    throw new ContractError(
      'INBOX_PAGE_CHAIN_APPEND_QUERY_INVALID',
      'Supply the complete original identity, archive digest and exact expected local head digest/page count from a comparison',
      { trace_id: trace, retryable: false, acknowledgement_dispatch_state: 'not-sent' },
    );
  }
}
