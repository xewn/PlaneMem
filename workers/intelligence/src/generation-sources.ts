import {
  ContractError,
  buildEtag,
  createUlid,
  isSyncIdentifier,
  proposalText,
  syncJsonSnapshot,
  validateSourceRef,
  type Classification,
  type SourceRef,
} from '@planemem/contracts';
import { FetchWcpTransport } from '@planemem/sdk';
import { normalizeQueueBinding, type ProposalQueueBinding } from './submission.js';
import {
  parseProposalGenerationRequest,
  type ProposalGenerationRequest,
  type ProposalGenerationSource,
} from './generation.js';

export interface ProposalGenerationSelection extends Omit<ProposalGenerationRequest, 'sources'> {
  sources: { item_id: string; revision: number }[];
  timeout_ms?: number;
}
export interface ProposalSourcePreparationOptions {
  access_token: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}
export interface PreparedProposalGeneration {
  schema_version: 1;
  trace_id: string;
  prepared_at: string;
  binding: ProposalQueueBinding;
  selection: Required<ProposalGenerationSelection>;
  observations: {
    item_id: string;
    revision: number;
    status: 'proposed' | 'confirmed';
    classification: Classification;
    checked_at: string;
    expires_at: string | null;
  }[];
  input: Required<ProposalGenerationRequest>;
}

function object(value: unknown, allowed?: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (allowed && Object.keys(row).some((key) => !allowed.includes(key))) throw new TypeError();
  return row;
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function refKey(value: unknown) {
  const ref = validateSourceRef(value);
  return JSON.stringify([ref.type, ref.id, ref.revision ?? null, ref.uri ?? null]);
}
export function parseProposalGenerationSelection(
  value: unknown,
): Required<ProposalGenerationSelection> {
  const row = object(JSON.parse(syncJsonSnapshot(value, 32 * 1024)), [
    'kind',
    'task',
    'sources',
    'classification',
    'ttl_seconds',
    'timeout_ms',
  ]);
  if (!Array.isArray(row.sources) || row.sources.length < 1 || row.sources.length > 32)
    throw new TypeError();
  const seen = new Set<string>();
  const sources = row.sources.map((value) => {
    const source = object(value, ['item_id', 'revision']);
    if (
      !isSyncIdentifier(source.item_id) ||
      source.item_id === '.' ||
      source.item_id === '..' ||
      typeof source.revision !== 'number' ||
      !Number.isSafeInteger(source.revision) ||
      source.revision < 1 ||
      seen.has(source.item_id)
    )
      throw new TypeError();
    seen.add(source.item_id);
    return { item_id: source.item_id, revision: source.revision };
  });
  const normalized = parseProposalGenerationRequest({
    kind: row.kind,
    task: row.task,
    sources: sources.map((source) => ({
      ref: { type: 'context-item', id: source.item_id, revision: source.revision },
      excerpt: 'Pending source read',
      classification: 'public',
    })),
    ...(row.classification === undefined ? {} : { classification: row.classification }),
    ...(row.ttl_seconds === undefined ? {} : { ttl_seconds: row.ttl_seconds }),
  });
  const timeout = row.timeout_ms === undefined ? 60000 : row.timeout_ms;
  if (
    typeof timeout !== 'number' ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1000 ||
    timeout > 120000
  )
    throw new TypeError();
  return {
    kind: normalized.kind,
    task: normalized.task,
    sources,
    classification: normalized.classification,
    ttl_seconds: normalized.ttl_seconds,
    timeout_ms: timeout,
  };
}

/** Read caller-selected current versions under one fixed identity; never call a model or write remotely. */
export async function prepareProposalGeneration(
  input: ProposalGenerationSelection,
  binding: ProposalQueueBinding,
  options: ProposalSourcePreparationOptions,
): Promise<PreparedProposalGeneration> {
  const trace = 'trace_generation_sources_' + createUlid();
  let currentId: string | undefined;
  const fail = (code: string, details: Record<string, unknown> = {}): never => {
    throw new ContractError(
      code,
      'Could not prepare all selected proposal sources; retain the original selection',
      {
        trace_id: trace,
        retryable: false,
        ...(currentId === undefined ? {} : { item_id: currentId }),
        ...details,
      },
    );
  };
  let selection: Required<ProposalGenerationSelection>;
  let identity: ProposalQueueBinding;
  let token: string;
  let signal: AbortSignal | undefined;
  let fetcher: typeof fetch;
  try {
    selection = parseProposalGenerationSelection(input);
    identity = normalizeQueueBinding(
      JSON.parse(syncJsonSnapshot(binding, 16 * 1024)) as ProposalQueueBinding,
    );
    if (
      !options ||
      typeof options.access_token !== 'string' ||
      !/^[\x21-\x7e]{1,8192}$/.test(options.access_token)
    )
      throw new TypeError();
    token = options.access_token;
    signal = options.signal;
    fetcher = options.fetch ?? globalThis.fetch;
    if (
      typeof fetcher !== 'function' ||
      (signal !== undefined &&
        (!signal ||
          typeof signal.aborted !== 'boolean' ||
          typeof signal.addEventListener !== 'function' ||
          typeof signal.removeEventListener !== 'function'))
    )
      throw new TypeError();
  } catch {
    return fail('PROPOSAL_SOURCE_PREPARATION_INPUT_INVALID');
  }
  const deadline = performance.now() + selection.timeout_ms;
  const remaining = () => {
    if (signal?.aborted) fail('PROPOSAL_SOURCE_PREPARATION_CANCELED');
    const time = Math.ceil(deadline - performance.now());
    if (time < 1) fail('PROPOSAL_SOURCE_PREPARATION_TIMEOUT');
    return time;
  };
  const headers = {
    'x-trace-id': trace,
    'x-tenant-id': identity.tenant_id,
    'x-workspace-id': identity.workspace_id,
    'x-project-id': identity.project_id,
    'x-expected-actor-id': identity.actor_id,
    'x-expected-client-id': identity.client_id,
  };
  const read = async (path: string, maximum: number) => {
    const transport = new FetchWcpTransport({
      base_url: identity.gateway_url,
      access_token: () => token,
      timeout_ms: remaining(),
      fetch: fetcher,
    });
    try {
      const response = await transport.request<unknown>({
        method: 'GET',
        path,
        headers,
        response_type: 'bounded-json',
        max_response_bytes: maximum,
        ...(signal === undefined ? {} : { signal }),
      });
      remaining();
      return object(response);
    } catch (error) {
      remaining();
      return fail('PROPOSAL_SOURCE_PREPARATION_READ_FAILED', {
        cause_code:
          error instanceof ContractError && /^[A-Z][A-Z0-9_]{1,127}$/.test(error.envelope.code)
            ? error.envelope.code
            : 'GATEWAY_RESPONSE_INVALID',
      });
    }
  };
  const preflight = await read('/v1/proposals/submission-context', 16 * 1024);
  try {
    const data = object(preflight.data);
    if (
      preflight.schema_version !== 1 ||
      preflight.trace_id !== trace ||
      !Array.isArray(preflight.source_refs) ||
      preflight.source_refs.length !== 0 ||
      data.identity_preconditions !== 1
    )
      throw new TypeError();
    for (const field of [
      'tenant_id',
      'workspace_id',
      'project_id',
      'actor_id',
      'client_id',
    ] as const)
      if (data[field] !== identity[field]) throw new TypeError();
  } catch {
    return fail('PROPOSAL_SOURCE_PREPARATION_IDENTITY_INVALID');
  }

  const sources: ProposalGenerationSource[] = [];
  const observations: PreparedProposalGeneration['observations'] = [];
  for (const selected of selection.sources) {
    currentId = selected.item_id;
    const response = await read(
      '/v1/context-items/' + encodeURIComponent(selected.item_id),
      1024 * 1024,
    );
    let item: Record<string, unknown>;
    let sourceCheck: Record<string, unknown>;
    let classification: Classification;
    let title: string;
    let expires: string | null;
    try {
      item = object(response.data);
      sourceCheck = object(item.source_check);
      if (
        response.schema_version !== 1 ||
        response.trace_id !== trace ||
        item.id !== selected.item_id ||
        typeof item.version !== 'number' ||
        !Number.isSafeInteger(item.version) ||
        item.version < 1 ||
        response.revision !== item.version ||
        response.etag !== buildEtag(item.version) ||
        !Array.isArray(item.source_refs) ||
        item.source_refs.length > 32 ||
        !Array.isArray(response.source_refs) ||
        response.source_refs.length !== item.source_refs.length + 1 ||
        typeof item.classification !== 'string' ||
        !['public', 'internal', 'confidential', 'restricted'].includes(item.classification) ||
        typeof item.status !== 'string' ||
        !['confirmed', 'proposed', 'expired', 'excluded'].includes(item.status) ||
        typeof item.sources_current !== 'boolean' ||
        sourceCheck.scope !== 'local-context-items' ||
        !timestamp(sourceCheck.checked_at) ||
        (item.expires_at !== null && !timestamp(item.expires_at))
      )
        throw new TypeError();
      for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
        if (item[field] !== identity[field]) throw new TypeError();
      const first = validateSourceRef(response.source_refs[0]);
      if (
        first.type !== 'context-item' ||
        first.id !== selected.item_id ||
        first.revision !== item.version ||
        first.uri !== undefined
      )
        throw new TypeError();
      for (let index = 0; index < item.source_refs.length; index++)
        if (refKey(item.source_refs[index]) !== refKey(response.source_refs[index + 1]))
          throw new TypeError();
      title = proposalText(item.title, 'source title', 300);
      classification = item.classification as Classification;
      expires = item.expires_at;
    } catch {
      return fail('PROPOSAL_SOURCE_PREPARATION_RESPONSE_INVALID');
    }
    if (item.version !== selected.revision)
      fail('PROPOSAL_SOURCE_PREPARATION_VERSION_CONFLICT', {
        expected_revision: selected.revision,
        current_revision: item.version,
      });
    if (
      (item.status !== 'proposed' && item.status !== 'confirmed') ||
      item.sources_current !== true ||
      sourceCheck.state !== 'current' ||
      (expires !== null && Date.parse(expires) <= Date.now())
    )
      return fail('PROPOSAL_SOURCE_PREPARATION_STALE');
    if (typeof item.content !== 'string') return fail('PROPOSAL_SOURCE_PREPARATION_TEXT_REQUIRED');
    // Preserve observed status in the excerpt so a proposed source is not presented as confirmed.
    const excerpt = 'Title: ' + title + '\nObserved status: ' + item.status + '\n\n' + item.content;
    if (excerpt.length > 65536 || !item.content.trim())
      fail('PROPOSAL_SOURCE_PREPARATION_CONTENT_LIMIT');
    const ref: SourceRef = {
      type: 'context-item',
      id: selected.item_id,
      revision: selected.revision,
    };
    sources.push({ ref, excerpt, classification });
    observations.push({
      item_id: selected.item_id,
      revision: selected.revision,
      status: item.status,
      classification,
      checked_at: sourceCheck.checked_at as string,
      expires_at: expires,
    });
    try {
      // Check the accumulated request after every read, not only after fetching all remaining sources.
      const accumulated = parseProposalGenerationRequest({
        kind: selection.kind,
        task: selection.task,
        classification: selection.classification,
        ttl_seconds: selection.ttl_seconds,
        sources,
      });
      if (
        new TextEncoder().encode(JSON.stringify(accumulated, null, 2) + '\n').byteLength >
        512 * 1024
      )
        throw new TypeError();
    } catch {
      return fail('PROPOSAL_SOURCE_PREPARATION_CONTENT_LIMIT');
    }
  }
  currentId = undefined;
  const preparedInput = parseProposalGenerationRequest({
    kind: selection.kind,
    task: selection.task,
    classification: selection.classification,
    ttl_seconds: selection.ttl_seconds,
    sources,
  });
  remaining();
  if (
    observations.some(
      (entry) => entry.expires_at !== null && Date.parse(entry.expires_at) <= Date.now(),
    )
  )
    fail('PROPOSAL_SOURCE_PREPARATION_STALE');
  return {
    schema_version: 1,
    trace_id: trace,
    prepared_at: new Date().toISOString(),
    binding: identity,
    selection,
    observations,
    input: preparedInput,
  };
}
