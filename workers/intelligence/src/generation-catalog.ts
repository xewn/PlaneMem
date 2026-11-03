import { createHash } from 'node:crypto';
import { opendir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { normalizeQueueBinding, type ProposalQueueBinding } from './queue-binding.js';
import {
  directory,
  readOptional,
  readState,
  JournalReadBudgetExceeded,
} from './generation-journal-read.js';
import {
  GENERATION_REQUEST_BYTES,
  generationRequestSummary,
  inspectGenerationRequest,
  validateGenerationRequestKey,
  type ProposalGenerationRequestState,
} from './generation-request.js';

const directoryEntries = 10_000;
const scanLimit = 64;
const pageBytes = 32 * 1024 * 1024;
export interface ProposalGenerationCatalogQuery {
  after?: string;
  limit?: number;
  state?: ProposalGenerationRequestState['state'] | 'all';
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  return value as Record<string, unknown>;
}
function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function parseGenerationCatalogQuery(value: unknown = {}) {
  const row = object(JSON.parse(syncJsonSnapshot(value, 4096)));
  if (Object.keys(row).some((name) => !['after', 'limit', 'state'].includes(name)))
    throw new TypeError('Unknown generation directory query field');
  const limit = row.limit === undefined ? 10 : row.limit;
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 20)
    throw new TypeError('Use a request limit between 1 and 20');
  const state = row.state === undefined ? 'all' : row.state;
  if (
    typeof state !== 'string' ||
    !['all', 'prepared', 'attempted', 'generated', 'failed'].includes(state)
  )
    throw new TypeError('Use a known generation request state');
  if (
    row.after !== undefined &&
    (typeof row.after !== 'string' || row.after.length > 512 || !/^[A-Za-z0-9_-]+$/.test(row.after))
  )
    throw new ContractError(
      'PROPOSAL_GENERATION_REQUEST_CATALOG_CURSOR_INVALID',
      'Use the returned generation directory cursor',
    );
  return {
    limit,
    state: state as NonNullable<ProposalGenerationCatalogQuery['state']>,
    ...(row.after === undefined ? {} : { after: row.after as string }),
  };
}
function cursor(scope: string, after: string) {
  return Buffer.from(JSON.stringify({ v: 1, scope, after }), 'utf8').toString('base64url');
}
function position(value: string | undefined, scope: string): string | undefined {
  if (value === undefined) return undefined;
  try {
    const bytes = Buffer.from(value, 'base64url');
    const row = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (
      bytes.toString('base64url') !== value ||
      Object.keys(row).length !== 3 ||
      row.v !== 1 ||
      row.scope !== scope ||
      typeof row.after !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.after)
    )
      throw new TypeError();
    return row.after;
  } catch {
    throw new ContractError(
      'PROPOSAL_GENERATION_REQUEST_CATALOG_CURSOR_INVALID',
      'Use a cursor from the same directory, binding and state filter',
    );
  }
}
async function candidates(root: string) {
  const digests = new Set<string>();
  let count = 0;
  for await (const entry of await opendir(root)) {
    if (++count > directoryEntries)
      throw new ContractError(
        'PROPOSAL_GENERATION_REQUEST_CATALOG_LIMIT',
        'Directory enumeration exceeds its budget; use a known request key for direct lookup',
      );
    const matched = /^generation-([a-f0-9]{64})\.request\.json$/.exec(entry.name);
    if (matched) digests.add(matched[1]!);
  }
  return [...digests].sort();
}

/** Discover local requests without creating a queue/index, calling a model or changing attempts. */
export async function listGenerationRequests(
  directoryPath: string,
  binding: ProposalQueueBinding,
  value: ProposalGenerationCatalogQuery = {},
) {
  const query = parseGenerationCatalogQuery(value);
  const target = normalizeQueueBinding(
    JSON.parse(syncJsonSnapshot(binding, 16 * 1024)) as ProposalQueueBinding,
  );
  try {
    const root = await directory(directoryPath);
    const identity = await stat(root, { bigint: true });
    if (!identity.isDirectory()) throw new TypeError();
    const scope = hash(
      JSON.stringify({
        directory: root,
        device: identity.dev.toString(),
        inode: identity.ino.toString(),
        binding: target,
        state: query.state,
      }),
    );
    const after = position(query.after, scope);
    const remaining = (await candidates(root)).filter(
      (digest) => after === undefined || digest > after,
    );
    const budget = { remaining: pageBytes };
    const items: (ReturnType<typeof generationRequestSummary> & { key_sha256: string })[] = [];
    let scanned = 0;
    let index = 0;
    let last = after;
    let byteLimited = false;
    while (index < remaining.length && items.length < query.limit && scanned < scanLimit) {
      const digest = remaining[index]!;
      try {
        const input = await readOptional(
          join(root, 'generation-' + digest + '.request.json'),
          GENERATION_REQUEST_BYTES,
          budget,
        );
        const row = object(input);
        validateGenerationRequestKey(row.request_key);
        const originalBinding = object(object(row.preparation).preparation).binding;
        // Validate the whole request before skipping another binding. Never return its metadata.
        const request = inspectGenerationRequest(
          input,
          originalBinding as ProposalQueueBinding,
          row.request_key,
        );
        if (hash(request.request_key) !== digest) throw new TypeError();
        if (isDeepStrictEqual(request.preparation.preparation.binding, target)) {
          const current = await readState(root, target, request.request_key, budget, input);
          if (query.state === 'all' || current.state === query.state)
            items.push({ ...generationRequestSummary(current), key_sha256: digest });
        }
      } catch (error) {
        if (!(error instanceof JournalReadBudgetExceeded)) throw error;
        byteLimited = true;
        break;
      }
      // Advance only after the whole candidate has been inspected, including filtered-out rows.
      last = digest;
      scanned++;
      index++;
    }
    const more = index < remaining.length;
    if (more && scanned === 0)
      throw new ContractError(
        'PROPOSAL_GENERATION_REQUEST_CATALOG_LIMIT',
        'A request could not fit within the read budget',
      );
    return {
      schema_version: 1,
      binding: target,
      state_filter: query.state,
      limit: query.limit,
      items,
      scanned,
      read_budget_used: pageBytes - budget.remaining,
      next_cursor: more ? cursor(scope, last!) : null,
      stopped: !more
        ? 'end'
        : items.length >= query.limit
          ? 'limit'
          : byteLimited
            ? 'byte-limit'
            : 'scan-limit',
      consistency: 'per-request',
    };
  } catch (error) {
    if (
      error instanceof ContractError &&
      error.envelope.code.startsWith('PROPOSAL_GENERATION_REQUEST_CATALOG_')
    )
      throw error;
    throw new ContractError(
      'PROPOSAL_GENERATION_REQUEST_CATALOG_INVALID',
      'The requested directory page could not be completely verified; no partial page is returned',
    );
  }
}
