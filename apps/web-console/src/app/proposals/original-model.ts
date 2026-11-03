import {
  isUlid,
  parseCreateProposal,
  parseLegacyContextIdentity,
  syncJsonSnapshot,
  validateIdempotencyKey,
  type LegacyContextIdentity,
} from '@planemem/contracts';

export const PROPOSAL_ORIGINAL_BYTES = 1024 * 1024;
export interface ProposalSubmissionBinding {
  gateway_url: string;
  identity: LegacyContextIdentity;
}
export interface ProposalOriginal {
  schema_version: 1;
  kind: 'proposal-submission';
  binding: ProposalSubmissionBinding;
  request_key: string;
  draft: ReturnType<typeof parseCreateProposal>;
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError('Incomplete original proposal request');
  return row;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
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
export function parseProposalSubmissionBinding(value: unknown): ProposalSubmissionBinding {
  const row = object(value, ['gateway_url', 'identity']);
  if (typeof row.gateway_url !== 'string') throw new TypeError();
  const url = new URL(row.gateway_url);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new TypeError('Use the original gateway origin');
  const identity = parseLegacyContextIdentity(row.identity);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (!isUlid(identity[field])) throw new TypeError('Invalid proposal project identity');
  for (const field of ['actor_id', 'client_id'] as const)
    if (!/^[\x21-\x7e]{1,255}$/.test(identity[field]))
      throw new TypeError('Invalid proposal identity');
  return { gateway_url: url.origin, identity };
}
export function assertProposalSubmissionBinding(actual: unknown, expected: unknown) {
  if (
    JSON.stringify(parseProposalSubmissionBinding(actual)) !==
    JSON.stringify(parseProposalSubmissionBinding(expected))
  )
    throw new TypeError('Restore the original gateway, project, account and client');
}
export function parseProposalOriginal(value: unknown): ProposalOriginal {
  const detached: unknown = JSON.parse(syncJsonSnapshot(value, PROPOSAL_ORIGINAL_BYTES));
  const row = object(detached, ['schema_version', 'kind', 'binding', 'request_key', 'draft']);
  if (row.schema_version !== 1 || row.kind !== 'proposal-submission') throw new TypeError();
  const key = validateIdempotencyKey(row.request_key);
  if (!/^[\x21-\x7e]{1,255}$/.test(key)) throw new TypeError('Invalid original request key');
  const result: ProposalOriginal = {
    schema_version: 1,
    kind: 'proposal-submission',
    binding: parseProposalSubmissionBinding(row.binding),
    request_key: key,
    draft: parseCreateProposal(row.draft),
  };
  if (
    canonical(row.binding) !== canonical(result.binding) ||
    canonical(row.draft) !== canonical(result.draft)
  )
    throw new TypeError('Use the complete normalized original binding and draft');
  if (
    new TextEncoder().encode(JSON.stringify(result, null, 2)).byteLength > PROPOSAL_ORIGINAL_BYTES
  )
    throw new TypeError('Original proposal request exceeds 1 MiB');
  return result;
}
export function encodeProposalOriginal(value: unknown) {
  return canonical(parseProposalOriginal(value));
}
export function decodeProposalOriginal(raw: unknown) {
  if (
    typeof raw !== 'string' ||
    !raw ||
    raw.length > PROPOSAL_ORIGINAL_BYTES ||
    new TextEncoder().encode(raw).byteLength > PROPOSAL_ORIGINAL_BYTES
  )
    throw new TypeError('Use complete original request JSON no larger than 1 MiB');
  return parseProposalOriginal(JSON.parse(raw.replace(/^\uFEFF/, '')));
}
export function proposalOriginalStorageKey(binding: ProposalSubmissionBinding, key: string) {
  validateIdempotencyKey(key);
  if (!/^[\x21-\x7e]{1,255}$/.test(key)) throw new TypeError();
  return (
    'planemem:proposal-original:v1:' +
    JSON.stringify([parseProposalSubmissionBinding(binding), key])
  );
}
export function preserveProposalOriginal(original: ProposalOriginal) {
  const raw = encodeProposalOriginal(original);
  const key = proposalOriginalStorageKey(original.binding, original.request_key);
  const existing = sessionStorage.getItem(key);
  if (existing !== null && encodeProposalOriginal(decodeProposalOriginal(existing)) !== raw)
    throw new TypeError('This request key already has different or damaged saved content');
  if (existing === null) sessionStorage.setItem(key, raw);
  const stored = sessionStorage.getItem(key);
  if (stored === null || encodeProposalOriginal(decodeProposalOriginal(stored)) !== raw)
    throw new TypeError('Original request saving could not be confirmed');
}
