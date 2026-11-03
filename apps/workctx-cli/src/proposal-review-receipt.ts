import { parseArgs } from 'node:util';
import {
  ContractError,
  parseProposalReviewReceiptQuery,
  assertProposalReceiptIdentity,
  syncJsonSnapshot,
  PROPOSAL_REVIEW_RECEIPT_REQUEST_BYTES,
  PROPOSAL_REVIEW_RECEIPT_RESPONSE_BYTES,
} from '@planemem/contracts';
import {
  WcpClient,
  FetchWcpTransport,
  type WcpTransport,
  type WcpRequest,
  type WcpProposalReviewReceiptOptions,
} from '@planemem/sdk';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';
import { readBoundedArtifactFile } from './artifact-files.js';

async function readProposalReviewReceiptFile(
  path: string,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
  trace: string,
) {
  let bytes;
  try {
    bytes = await readBoundedArtifactFile(path, PROPOSAL_REVIEW_RECEIPT_REQUEST_BYTES, trace);
  } catch {
    throw new ContractError(
      'PROPOSAL_REVIEW_RECEIPT_FILE_UNAVAILABLE',
      'Read a stable regular original identity/key/decision/reason/revision JSON file within the receipt limit',
      { trace_id: trace },
    );
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const query = parseProposalReviewReceiptQuery(JSON.parse(text.replace(/^\uFEFF/, '')));
    for (const key of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (query.identity[key] !== scope[key]) throw new TypeError();
    return query;
  } catch {
    throw invalid(trace);
  }
}

function invalid(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use proposals review-receipt with --json-file ORIGINAL.json or --json ORIGINAL and optional --timeout-ms; keep the saved identity, request_key and complete normalized review decision, reason and revision. No --key or repeated options',
    { trace_id: trace, retryable: false },
  );
}

async function readArguments(
  argv: string[],
  scope: { tenant_id: string; workspace_id: string; project_id: string },
  trace: string,
) {
  let args;
  let timeout_ms;
  try {
    args = parseArgs({
      args: [...argv],
      tokens: true,
      allowPositionals: true,
      options: {
        json: { type: 'string' },
        'json-file': { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
    });
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const rawTimeout = args.values['timeout-ms'] ?? '30000';
    timeout_ms = Number(rawTimeout);
    if (
      args.positionals.length !== 2 ||
      args.positionals.join(' ') !== 'proposals review-receipt' ||
      (args.values.json === undefined) === (args.values['json-file'] === undefined) ||
      args.values.json === '-' ||
      args.values['json-file'] === '-' ||
      (args.values['json-file'] !== undefined && !args.values['json-file'].trim()) ||
      !/^[1-9][0-9]{0,9}$/.test(rawTimeout) ||
      timeout_ms > 2147483647
    )
      throw new TypeError();
  } catch {
    throw invalid(trace);
  }
  const file = args.values['json-file'];
  if (file !== undefined)
    return { query: await readProposalReviewReceiptFile(file, scope, trace), timeout_ms };
  try {
    const raw = args.values.json;
    if (raw === undefined || Buffer.byteLength(raw, 'utf8') > PROPOSAL_REVIEW_RECEIPT_REQUEST_BYTES)
      throw new TypeError();
    const query = parseProposalReviewReceiptQuery(JSON.parse(raw));
    for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (query.identity[field] !== scope[field]) throw new TypeError();
    return { query, timeout_ms };
  } catch {
    throw invalid(trace);
  }
}

export async function callProposalReviewReceiptArguments(
  argv: string[],
  options: {
    base: string;
    token: string;
    trace: string;
    scope: { tenant_id: string; workspace_id: string; project_id: string };
  },
) {
  const snapshot = structuredClone(options);
  const { query, timeout_ms } = await readArguments(argv, snapshot.scope, snapshot.trace);
  return callProposalReviewReceipt(query, { ...snapshot, timeout_ms });
}

export async function callProposalReviewReceipt(
  input: unknown,
  options: {
    base: string;
    token: string;
    trace: string;
    scope: { tenant_id: string; workspace_id: string; project_id: string };
    key?: string | undefined;
    timeout_ms?: number;
    signal?: AbortSignal;
  },
) {
  let query;
  let client: WcpClient;
  try {
    if (options.key !== undefined) throw new TypeError();
    query = parseProposalReviewReceiptQuery(input);
    for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (query.identity[field] !== options.scope[field]) throw new TypeError();
    const base = new URL(options.base);
    const token = options.token.trim();
    if (base.search || base.hash || !token) throw new TypeError();
    new Headers({ authorization: 'Bearer ' + token });
    client = new WcpClient(
      new FetchWcpTransport({
        base_url: base.href,
        access_token: () => token,
        timeout_ms: options.timeout_ms === undefined ? 30_000 : options.timeout_ms,
      }),
      { ...options.scope, trace_id: options.trace },
    );
  } catch {
    throw invalid(options.trace);
  }
  return client.getProposalReviewReceipt(query, {
    timeout_ms: options.timeout_ms === undefined ? 30_000 : options.timeout_ms,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}
function verifiedReceiptContext(original: RequestContext) {
  const context = structuredClone(original);
  delete context.idempotency_key;
  delete context.expected_version;
  const trace = context.trace_id;
  const authority = () => {
    const expiry = Date.parse(context.token_expires_at ?? '');
    if (
      context.authenticated_client !== true ||
      context.actor_type !== 'human' ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now() ||
      (context.roles?.includes('admin') !== true && !context.capability.includes('proposal.review'))
    )
      throw new ContractError(
        'DENIED',
        'Use the original verified unexpired human proposal reviewer to check its receipt',
        {
          trace_id: trace,
          retryable: false,
        },
      );
  };
  authority();
  return { context, trace, authority };
}
export async function runProposalReviewReceipt(
  argv: string[],
  router: CommandRouter,
  original: RequestContext,
) {
  const { context, trace } = verifiedReceiptContext(original);
  const { query, timeout_ms } = await readArguments(argv, context, trace);
  return readEmbeddedProposalReviewReceipt(query, router, context, { timeout_ms });
}

/** Shared verified read for saved original query files and embedded CLI callers. */
export async function readEmbeddedProposalReviewReceipt(
  input: unknown,
  router: CommandRouter,
  original: RequestContext,
  options: WcpProposalReviewReceiptOptions = {},
) {
  const { context, trace, authority } = verifiedReceiptContext(original);
  const query = parseProposalReviewReceiptQuery(input);
  try {
    assertProposalReceiptIdentity(query.identity, context);
  } catch {
    throw new ContractError(
      'DENIED',
      'Use the original verified account, client and project to read this receipt',
      { trace_id: trace, retryable: false },
    );
  }
  const target = parseProposalReviewReceiptQuery(query);
  const headers: Record<string, string> = {
    'x-trace-id': trace,
    'x-tenant-id': context.tenant_id,
    'x-workspace-id': context.workspace_id,
    'x-project-id': context.project_id,
    'x-expected-actor-id': context.actor_id,
    'x-expected-client-id': context.client_id,
  };
  const transport: WcpTransport = {
    async request<T = unknown>(request: WcpRequest): Promise<T> {
      authority();
      if (
        request.method !== 'POST' ||
        request.path !== '/v1/proposals/review-receipt' ||
        request.response_type !== 'bounded-json' ||
        request.max_response_bytes !== PROPOSAL_REVIEW_RECEIPT_RESPONSE_BYTES ||
        Object.keys(request.headers).length !== 6 ||
        Object.entries(headers).some(([key, value]) => request.headers[key] !== value) ||
        syncJsonSnapshot(request.body, PROPOSAL_REVIEW_RECEIPT_REQUEST_BYTES) !==
          syncJsonSnapshot(target, PROPOSAL_REVIEW_RECEIPT_REQUEST_BYTES)
      )
        throw invalid(trace);
      if (request.signal?.aborted)
        throw new ContractError(
          'GATEWAY_REQUEST_CANCELED',
          'Stopped waiting for the original receipt',
          { trace_id: trace },
        );
      const result = await router.execute({
        operation: 'proposal.review.receipt',
        input: { ...parseProposalReviewReceiptQuery(target) },
        context: structuredClone(context),
      });
      authority();
      return result as unknown as T;
    },
  };
  return new WcpClient(transport, {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
    trace_id: trace,
  }).getProposalReviewReceipt(query, options);
}
