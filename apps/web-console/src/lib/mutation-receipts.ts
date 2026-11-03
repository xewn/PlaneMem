import { isUlid } from '@planemem/contracts';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid gateway receipt');
  return value as Record<string, unknown>;
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && /Z$/.test(value) && Number.isFinite(Date.parse(value));
}

export function validateProposalReceipt(
  value: unknown,
  expected: { id?: string; status: 'proposed' | 'verified' | 'rejected'; revision: number },
): void {
  const receipt = record(value);
  if (
    !isUlid(receipt.proposal_id) ||
    (expected.id !== undefined && receipt.proposal_id !== expected.id) ||
    receipt.status !== expected.status ||
    receipt.revision !== expected.revision ||
    !Number.isSafeInteger(receipt.revision) ||
    !isUlid(receipt.event_id) ||
    !timestamp(receipt.occurred_at) ||
    typeof receipt.replayed !== 'boolean'
  )
    throw new TypeError('The gateway did not return the expected proposal receipt');
}

/** Check command identity and budget metadata before navigating to the saved pack. */
export function validatePackReceipt(value: unknown, budget: number, ttl: number): void {
  const receipt = record(value);
  const pack = record(receipt.pack);
  const scope = record(pack.scope);
  if (
    !isUlid(receipt.pack_id) ||
    typeof receipt.version !== 'number' ||
    !Number.isSafeInteger(receipt.version) ||
    receipt.version < 1 ||
    !timestamp(receipt.created_at) ||
    typeof receipt.used_tokens !== 'number' ||
    !Number.isSafeInteger(receipt.used_tokens) ||
    receipt.used_tokens < 0 ||
    receipt.used_tokens > budget ||
    pack.schema_version !== 1 ||
    pack.pack_version !== 1 ||
    pack.budget_tokens !== budget ||
    typeof pack.pack_hash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(pack.pack_hash) ||
    !isUlid(scope.tenant_id) ||
    !isUlid(scope.workspace_id) ||
    !isUlid(scope.project_id) ||
    !Array.isArray(pack.items) ||
    !Array.isArray(pack.exclusions) ||
    !Array.isArray(pack.source_refs) ||
    !timestamp(pack.expires_at) ||
    Date.parse(pack.expires_at) <= Date.parse(receipt.created_at) ||
    Date.parse(pack.expires_at) > Date.parse(receipt.created_at) + ttl * 1000
  )
    throw new TypeError('The gateway did not return the expected context pack receipt');
}
