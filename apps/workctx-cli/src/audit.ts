import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  ContractError,
  AUDIT_EXPORT_RESPONSE_BYTES,
  auditExportDocument,
  auditExportDocumentJson,
  parseWorkbenchAuditQuery,
  parseWorkbenchAuditEnvelope,
  validateRequestContext,
  isUlid,
  type WorkbenchAuditScope,
  type AuditExportEnvelope,
} from '@planemem/contracts';
import { FetchWcpTransport, WcpClient, type WcpTransport, type WcpRequest } from '@planemem/sdk';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';
import { readBoundedArtifactFile } from './artifact-files.js';
import { prepareArtifactOutput, saveArtifactOutput } from './artifact-output.js';

type AuditArguments =
  | {
      kind: 'list' | 'get';
      json?: string;
      file?: string;
      timeout_ms: number;
    }
  | {
      kind: 'export';
      file: string;
      output: string;
      timeout_ms: number;
    };

export function isAuditCommand(name: string): boolean {
  return ['audit list', 'audit get', 'audit export'].includes(name);
}

function usage(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use audit list with optional --json QUERY or --json-file QUERY.json; audit get requires only audit_id in that query. Use audit export --json-file REVIEWED_SINGLE_RECORD.json --reviewed --output NEW_FILE. Optional --timeout-ms; no stdin, --key, repeated flags or extra options.',
    { trace_id: trace, dispatch_state: 'not-sent' },
  );
}

function parseArguments(argv: string[], trace: string): AuditArguments {
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      tokens: true,
      options: {
        json: { type: 'string' },
        'json-file': { type: 'string' },
        output: { type: 'string' },
        reviewed: { type: 'boolean' },
        'timeout-ms': { type: 'string' },
      },
    });
    if (parsed.positionals.length !== 2 || !isAuditCommand(parsed.positionals.join(' ')))
      throw new TypeError();
    const seen = new Set<string>();
    for (const token of parsed.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const kind = parsed.positionals[1];
    const { json, output, reviewed } = parsed.values;
    const file = parsed.values['json-file'];
    const rawTimeout = parsed.values['timeout-ms'];
    if (rawTimeout !== undefined && !/^[1-9][0-9]{0,9}$/.test(rawTimeout)) throw new TypeError();
    const timeout =
      rawTimeout === undefined ? (kind === 'export' ? 90_000 : 30_000) : Number(rawTimeout);
    if (
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 2_147_483_647 ||
      json === '-' ||
      file === '-' ||
      (file !== undefined && !file.trim()) ||
      (json !== undefined && file !== undefined)
    )
      throw new TypeError();
    if (kind === 'export') {
      if (json !== undefined || !file || reviewed !== true || !output?.trim() || output === '-')
        throw new TypeError();
      return { kind, file, output, timeout_ms: timeout };
    }
    if (
      (kind !== 'list' && kind !== 'get') ||
      output !== undefined ||
      reviewed !== undefined ||
      (kind === 'get' && json === undefined && file === undefined)
    )
      throw new TypeError();
    return {
      kind,
      ...(json === undefined ? {} : { json }),
      ...(file === undefined ? {} : { file }),
      timeout_ms: timeout,
    };
  } catch {
    throw usage(trace);
  }
}

function parseText(text: string, maximum: number, trace: string): unknown {
  try {
    if (Buffer.byteLength(text, 'utf8') > maximum) throw new TypeError();
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw usage(trace);
  }
}

async function readInput(path: string, maximum: number, trace: string): Promise<unknown> {
  let bytes;
  try {
    bytes = await readBoundedArtifactFile(path, maximum, trace);
  } catch {
    throw new ContractError(
      'AUDIT_INPUT_UNAVAILABLE',
      'Read a stable regular UTF-8 JSON file within the audit input limit',
      {
        trace_id: trace,
        dispatch_state: 'not-sent',
      },
    );
  }
  try {
    return parseText(new TextDecoder('utf-8', { fatal: true }).decode(bytes), maximum, trace);
  } catch {
    throw usage(trace);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  return value as Record<string, unknown>;
}

function reviewedPage(value: unknown, scope: WorkbenchAuditScope, trace: string) {
  try {
    const input = record(value);
    if (
      Object.keys(input).some(
        (key) =>
          !['schema_version', 'trace_id', 'source_refs', 'scope', 'data', 'has_more'].includes(key),
      ) ||
      typeof input.trace_id !== 'string' ||
      !input.trace_id.length ||
      input.trace_id.length > 512 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(input.trace_id) ||
      !Array.isArray(input.data) ||
      input.data.length !== 1 ||
      input.has_more !== false
    )
      throw new TypeError();
    const id = record(input.data[0]).audit_id;
    if (!isUlid(id)) throw new TypeError();
    const page = parseWorkbenchAuditEnvelope(input, { audit_id: id }, scope, input.trace_id);
    const document = auditExportDocument(scope, page.data[0]!);
    // Fail locally on views that are readable but cannot be canonically exported.
    auditExportDocumentJson(document);
    return { document, review_trace_id: page.trace_id };
  } catch {
    throw usage(trace);
  }
}

function contextFor(scope: WorkbenchAuditScope, trace: string) {
  try {
    return validateRequestContext({
      tenant_id: scope.tenant_id,
      workspace_id: scope.workspace_id,
      project_id: scope.project_id,
      trace_id: trace,
    });
  } catch {
    throw usage(trace);
  }
}

async function executeAudit(
  args: AuditArguments,
  client: WcpClient,
  scope: WorkbenchAuditScope,
  trace: string,
) {
  if (args.kind !== 'export') {
    const raw =
      args.json !== undefined
        ? parseText(args.json, 16 * 1024, trace)
        : args.file === undefined
          ? {}
          : await readInput(args.file, 16 * 1024, trace);
    let query;
    try {
      query = parseWorkbenchAuditQuery(raw);
      if (
        args.kind === 'get' &&
        (query.audit_id === undefined || Object.keys(query).some((key) => key !== 'audit_id'))
      )
        throw new TypeError();
    } catch {
      throw usage(trace);
    }
    return client.listAuditRecords(query, { timeout_ms: args.timeout_ms });
  }

  const selected = reviewedPage(
    await readInput(args.file, AUDIT_EXPORT_RESPONSE_BYTES, trace),
    scope,
    trace,
  );
  let output;
  try {
    output = await prepareArtifactOutput(args.output, trace);
  } catch {
    throw new ContractError(
      'AUDIT_OUTPUT_UNAVAILABLE',
      'Choose a new output file in an existing directory; files and links are never replaced',
      {
        trace_id: trace,
        dispatch_state: 'not-sent',
        local_state: 'not-saved',
        audit_state: 'not-requested',
      },
    );
  }
  let exported: AuditExportEnvelope | undefined;
  let localFailure: Record<string, unknown> = {};
  try {
    exported = await client.exportAuditView(selected.document, { timeout_ms: args.timeout_ms });
    const content = Buffer.from(JSON.stringify(exported), 'utf8');
    if (content.byteLength > AUDIT_EXPORT_RESPONSE_BYTES) throw new TypeError();
    const fileHash = createHash('sha256').update(content).digest('hex');
    let local;
    try {
      local = await saveArtifactOutput(output, content, fileHash, trace);
    } catch (error) {
      if (error instanceof ContractError) localFailure = error.envelope.details;
      throw new ContractError(
        'AUDIT_SAVE_FAILED',
        'The verified export could not be saved; inspect local and temporary-file state before another request',
        { trace_id: trace },
      );
    }
    return {
      schema_version: 1,
      trace_id: trace,
      source_refs: exported.source_refs,
      data: {
        audit_id: selected.document.record.audit_id,
        review_trace_id: selected.review_trace_id,
        document_sha256: exported.data.document_sha256,
        document_bytes: exported.data.document_bytes,
        content_state: 'verified',
        release_audit_id: exported.data.release_audit_id,
        audit_state: 'release-recorded',
        client_delivery_state: 'not-confirmed',
        local: { ...local, file_bytes: content.byteLength, file_sha256: fileHash },
      },
    };
  } catch (error) {
    const envelope =
      error instanceof ContractError && error.envelope.trace_id === trace
        ? error.envelope
        : undefined;
    const candidate =
      envelope?.details.audit_state === 'release-recorded'
        ? envelope.details.release_audit_id
        : undefined;
    const release =
      exported?.data.release_audit_id ??
      (isUlid(candidate) && candidate !== selected.document.record.audit_id
        ? candidate
        : undefined);
    throw new ContractError(
      envelope?.code ?? 'AUDIT_EXPORT_FAILED',
      envelope?.message ?? 'The audit export could not be completed',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...localFailure,
          output_path: output.path,
          local_state: 'not-saved',
          audit_id: selected.document.record.audit_id,
          review_trace_id: selected.review_trace_id,
          audit_state: release ? 'release-recorded' : 'unconfirmed',
          ...(release ? { release_audit_id: release } : {}),
          client_delivery_state: 'not-confirmed',
          recovery:
            'Review the original selection, trace and local files before another explicit request; an unconfirmed release may still exist.',
        },
      },
    );
  }
}

export async function callAudit(
  argv: string[],
  options: { base: string; token: string; scope: WorkbenchAuditScope; trace: string },
) {
  const trace = options.trace;
  const args = parseArguments([...argv], trace);
  const scope = {
    tenant_id: options.scope.tenant_id,
    workspace_id: options.scope.workspace_id,
    project_id: options.scope.project_id,
  };
  const context = contextFor(scope, trace);
  let client;
  try {
    const token = options.token.trim();
    const base = new URL(options.base);
    if (!token || base.search || base.hash) throw new TypeError();
    new Headers({ authorization: 'Bearer ' + token });
    client = new WcpClient(
      new FetchWcpTransport({
        base_url: base.href,
        access_token: () => token,
        timeout_ms: args.timeout_ms,
      }),
      context,
    );
  } catch {
    throw usage(trace);
  }
  return executeAudit(args, client, scope, trace);
}

export async function runAudit(argv: string[], router: CommandRouter, original: RequestContext) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  const args = parseArguments([...argv], trace);
  const scope = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
  };
  const clientContext = contextFor(scope, trace);
  delete context.idempotency_key;
  delete context.expected_version;
  const authorize = () => {
    const expiry = Date.parse(context.token_expires_at ?? '');
    if (
      context.authenticated_client !== true ||
      !context.capability.includes('audit.read') ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now() ||
      (args.kind === 'export' &&
        !context.capability.some(
          (value) => value === 'data.export' || value === 'data.restricted.export',
        ))
    )
      throw new ContractError(
        'DENIED',
        'Audit commands require a verified reader, valid session and export capability when exporting',
        { trace_id: trace },
      );
  };
  authorize();
  const transport: WcpTransport = {
    async request<T = unknown>(request: WcpRequest): Promise<T> {
      authorize();
      if (request.signal?.aborted)
        throw new ContractError(
          'GATEWAY_REQUEST_CANCELED',
          'Stopped waiting for the audit request',
          { trace_id: trace },
        );
      const operation =
        request.path === '/v1/workbench/query'
          ? 'workbench.query'
          : request.path === '/v1/audit/export'
            ? 'audit.export'
            : undefined;
      if (request.method !== 'POST' || request.response_type !== 'bounded-json' || !operation)
        throw new ContractError('INVALID_INPUT', 'Unsupported embedded audit request', {
          trace_id: trace,
        });
      const input = structuredClone(record(request.body));
      if (operation === 'workbench.query' && input.operation !== 'audit')
        throw new ContractError('INVALID_INPUT', 'Expected an audit query', { trace_id: trace });
      // The SDK validates the full result; this adapter only preserves the trusted command boundary.
      return (await router.execute({
        operation,
        input,
        context: structuredClone(context),
      })) as unknown as T;
    },
  };
  return executeAudit(args, new WcpClient(transport, clientContext), scope, trace);
}
