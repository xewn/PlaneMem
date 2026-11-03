import { parseArgs } from 'node:util';
import {
  ContractError,
  buildEtag,
  parseConflictReceiptQuery,
  assertConflictReceiptIdentity,
  conflictReceiptJson,
  CONFLICT_SUBMISSION_RESPONSE_BYTES,
} from '@planemem/contracts';
import { WcpClient, FetchWcpTransport, type WcpTransport, type WcpRequest } from '@planemem/sdk';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';
import { readConflictOriginalFile } from './conflict-files.js';

function invalid(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use conflicts submit --json-file ORIGINAL.json --reviewed, with optional --timeout-ms; keep the saved identity/key/command and do not supply --json, --key or repeated options',
    { trace_id: trace, retryable: false, dispatch_state: 'not-sent' },
  );
}
function argumentsFor(argv: string[], trace: string) {
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: {
        'json-file': { type: 'string' },
        reviewed: { type: 'boolean' },
        'timeout-ms': { type: 'string' },
      },
    });
    const seen = new Set<string>();
    for (const token of parsed.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const path = parsed.values['json-file'];
    const timeout = parsed.values['timeout-ms'] ?? '30000';
    if (
      parsed.positionals.length !== 2 ||
      parsed.positionals.join(' ') !== 'conflicts submit' ||
      parsed.values.reviewed !== true ||
      !path?.trim() ||
      path === '-' ||
      !/^[1-9][0-9]{0,9}$/.test(timeout) ||
      Number(timeout) > 2147483647
    )
      throw new TypeError();
    return { path, timeout_ms: Number(timeout) };
  } catch {
    throw invalid(trace);
  }
}
export async function callConflictSubmission(
  argv: string[],
  options: {
    base: string;
    token: string;
    trace: string;
    scope: { tenant_id: string; workspace_id: string; project_id: string };
  },
) {
  const { path, timeout_ms } = argumentsFor(argv, options.trace);
  const scope = { ...options.scope };
  const trace = options.trace;
  let transport: FetchWcpTransport;
  try {
    const base = new URL(options.base);
    const token = options.token.trim();
    if (base.search || base.hash || !token) throw new TypeError();
    new Headers({ authorization: 'Bearer ' + token });
    transport = new FetchWcpTransport({
      base_url: base.href,
      access_token: () => token,
      timeout_ms,
    });
  } catch {
    throw invalid(trace);
  }
  const original = await readConflictOriginalFile(path, scope, trace);
  return new WcpClient(transport, { ...scope, trace_id: trace }).submitConflictDecision(original, {
    reviewed: true,
    timeout_ms,
  });
}

export async function runConflictSubmission(
  argv: string[],
  router: CommandRouter,
  inputContext: RequestContext,
) {
  const context = structuredClone(inputContext);
  const trace = context.trace_id;
  const { path, timeout_ms } = argumentsFor(argv, trace);
  const authority = () => {
    const expiry = Date.parse(context.token_expires_at ?? '');
    if (
      context.authenticated_client !== true ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now() ||
      (context.roles?.includes('admin') !== true &&
        !context.capability.includes('conflict.resolve'))
    )
      throw new ContractError(
        'DENIED',
        'Use the original verified unexpired conflict resolver; keep the saved request',
        { trace_id: trace, retryable: false },
      );
  };
  authority();
  const original = await readConflictOriginalFile(path, context, trace);
  try {
    assertConflictReceiptIdentity(original.identity, context);
    if (
      (context.idempotency_key !== undefined && context.idempotency_key !== original.request_key) ||
      (context.expected_version !== undefined &&
        context.expected_version !== original.command.expected_version)
    )
      throw new TypeError();
  } catch {
    throw invalid(trace);
  }
  context.idempotency_key = original.request_key;
  context.expected_version = original.command.expected_version;
  const headers: Record<string, string> = {
    'x-trace-id': trace,
    'x-tenant-id': original.identity.tenant_id,
    'x-workspace-id': original.identity.workspace_id,
    'x-project-id': original.identity.project_id,
    'x-expected-actor-id': original.identity.actor_id,
    'x-expected-client-id': original.identity.client_id,
    'idempotency-key': original.request_key,
    'if-match': buildEtag(original.command.expected_version),
  };
  const transport: WcpTransport = {
    async request<T = unknown>(request: WcpRequest): Promise<T> {
      authority();
      if (
        request.method !== 'POST' ||
        request.path !==
          '/v1/conflicts/' + encodeURIComponent(original.command.conflict_id) + '/resolve' ||
        request.response_type !== 'bounded-json' ||
        request.max_response_bytes !== CONFLICT_SUBMISSION_RESPONSE_BYTES ||
        Object.keys(request.headers).length !== 8 ||
        Object.entries(headers).some(([key, value]) => request.headers[key] !== value) ||
        conflictReceiptJson(request.body) !== conflictReceiptJson(original.command)
      )
        throw invalid(trace);
      if (request.signal?.aborted)
        throw new ContractError(
          'GATEWAY_REQUEST_CANCELED',
          'Stopped waiting; keep the original request and check its receipt',
          { trace_id: trace },
        );
      const result = await router.execute({
        operation: 'conflict.resolve',
        input: parseConflictReceiptQuery(original).command,
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
  }).submitConflictDecision(original, { reviewed: true, timeout_ms });
}
