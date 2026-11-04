import {
  ARTIFACT_UPLOAD_REQUEST_BYTES,
  ARTIFACT_VERSIONS_RESPONSE_BYTES,
  ARTIFACT_REGISTRY_RESPONSE_BYTES,
  ContractError,
  assertArtifactReceiptIdentity,
  isSyncIdentifier,
  parseArtifactReadEnvelope,
  parseArtifactReadQuery,
  parseArtifactReceiptEnvelope,
  parseArtifactReceiptQuery,
  parseArtifactVersionsQuery,
  parseArtifactVersionsEnvelope,
  parseArtifactRegistryQuery,
  parseArtifactRegistryEnvelope,
  syncJsonSnapshot,
  type ArtifactReceiptQuery,
  type ArtifactVersionsQuery,
  type ArtifactRegistryQuery,
  type RequestContext,
} from '@planemem/contracts';
import type { WcpTransport } from './client.js';
import { createRequestBudget, type RequestBudget } from './request-budget.js';

export interface WcpArtifactReadOptions {
  timeout_ms?: number;
  signal?: AbortSignal;
}

const METADATA_BYTES = 2 * 1024 * 1024;
const RECEIPT_BYTES = 4 * 1024 * 1024;
const messages: Record<string, string> = {
  INVALID_INPUT:
    'Supply valid artifact identifiers, version pagination or the complete original receipt query, matching scope/identity constraints and timeout/signal options',
  DENIED: 'The current verified session cannot read the requested artifact data',
  UNAUTHENTICATED: 'Renew the matching session before reading artifact data',
  ARTIFACT_ACCESS_DENIED:
    'The current account or client cannot read this artifact metadata or original receipt',
  ARTIFACT_NOT_FOUND: 'The artifact is unavailable in this project',
  ARTIFACT_VERSION_NOT_FOUND: 'The requested historical artifact version is unavailable',
  ARTIFACT_VERSION_CONFLICT:
    'The original version could not be matched; keep the saved request unchanged',
  ARTIFACT_LEGACY_UNVERIFIED: 'The stored artifact lacks a verified historical snapshot',
  ARTIFACT_STORED_INVALID: 'Stored artifact metadata or receipt could not be verified',
  ARTIFACT_STORAGE_UNAVAILABLE: 'Artifact metadata or receipt storage is unavailable',
  IDEMPOTENCY_KEY_REUSED:
    'The original key belongs to different parameters; keep the saved request',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is unavailable',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The artifact read audit could not be persisted',
  RATE_LIMITED: 'Artifact read capacity is occupied',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for artifact metadata or receipt',
  GATEWAY_REQUEST_TIMEOUT: 'Artifact metadata or receipt exceeded the local deadline',
  GATEWAY_RESPONSE_INVALID:
    'The complete artifact response did not match this read or exceeded its size limit',
  GATEWAY_UNAVAILABLE: 'Artifact metadata or receipt could not be read',
};
type ReadKind = 'metadata' | 'receipt' | 'versions' | 'registry';
const registryMessages: Record<string, string> = {
  INVALID_INPUT:
    'Supply valid file filters, page settings and timeout/signal options. Preserve complete next_query for continuation, or restart without a cursor when scope, identity, permissions or filters change',
  ARTIFACT_ACCESS_DENIED: 'The current account or client cannot read the selected project files',
  ARTIFACT_NOT_FOUND: 'The project is unavailable to this account',
  ARTIFACT_LEGACY_UNVERIFIED: 'The selected files lack a verified metadata snapshot',
  ARTIFACT_STORED_INVALID: 'Stored project file directory records could not be verified',
  ARTIFACT_STORAGE_UNAVAILABLE: 'Project file directory storage is unavailable',
  GATEWAY_REQUEST_CANCELED: 'Stopped waiting for the project file directory',
  GATEWAY_REQUEST_TIMEOUT: 'Project file directory reading exceeded the local deadline',
  GATEWAY_UNAVAILABLE: 'The project file directory could not be read',
};
function failure(code: string, trace: string, kind: ReadKind) {
  const message =
    kind === 'registry' && Object.hasOwn(registryMessages, code)
      ? registryMessages[code]!
      : messages[code]!;
  return new ContractError(code, message, {
    trace_id: trace,
    retryable: false,
    details: {
      read_kind: kind,
      upload_dispatch_state: 'not-sent',
      ...(kind === 'receipt'
        ? {
            receipt_state: 'not-confirmed-by-this-read',
            recovery:
              'Keep the original identity, command, key and content. This failed read does not disprove any previous upload or receipt; do not replace the original request.',
          }
        : {}),
    },
  });
}
function validText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 1024 &&
    !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  );
}
function settingsFor(options: WcpArtifactReadOptions) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError();
  const prototype: unknown = Object.getPrototypeOf(options);
  const fields = Object.keys(options);
  if (
    (prototype !== null && prototype !== Object.prototype) ||
    Reflect.ownKeys(options).length !== fields.length ||
    fields.some(
      (key) =>
        !['timeout_ms', 'signal'].includes(key) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key)!, 'value'),
    )
  )
    throw new TypeError();
  const row = Object.fromEntries(
    fields.map((key) => [key, Object.getOwnPropertyDescriptor(options, key)!.value]),
  ) as WcpArtifactReadOptions;
  return { timeout: row.timeout_ms === undefined ? 30_000 : row.timeout_ms, signal: row.signal };
}
interface PreparedRead<T> {
  path: string;
  maximum: number;
  expected: { actor_id?: string; client_id?: string };
  body?: ArtifactReceiptQuery;
  parse: (raw: unknown) => T;
}
async function read<T>(
  transport: WcpTransport,
  original: RequestContext,
  options: WcpArtifactReadOptions,
  kind: ReadKind,
  prepare: (context: RequestContext) => PreparedRead<T>,
): Promise<T> {
  const context = { ...original };
  const trace = context.trace_id;
  let request: PreparedRead<T>;
  let budget: RequestBudget;
  try {
    if (
      !validText(trace) ||
      !context.project_id ||
      [context.tenant_id, context.workspace_id, context.project_id].some(
        (id) => !isSyncIdentifier(id) || id === '.' || id === '..',
      ) ||
      (context.actor_id !== undefined && !validText(context.actor_id)) ||
      (context.client_id !== undefined && !validText(context.client_id))
    )
      throw new TypeError();
    const settings = settingsFor(options);
    // Capture the complete original before transport/credential callbacks can change caller inputs.
    request = prepare(context);
    budget = createRequestBudget(trace, settings.timeout, settings.signal);
  } catch {
    throw failure('INVALID_INPUT', trace, kind);
  }
  try {
    const raw = await budget.wait(() =>
      transport.request({
        method: request.body === undefined ? 'GET' : 'POST',
        path: request.path,
        headers: {
          'x-trace-id': trace,
          'x-tenant-id': context.tenant_id,
          'x-workspace-id': context.workspace_id,
          'x-project-id': context.project_id!,
          ...(request.expected.actor_id === undefined
            ? {}
            : { 'x-expected-actor-id': request.expected.actor_id }),
          ...(request.expected.client_id === undefined
            ? {}
            : { 'x-expected-client-id': request.expected.client_id }),
        },
        ...(request.body === undefined ? {} : { body: request.body }),
        response_type: 'bounded-json',
        max_response_bytes: request.maximum,
        signal: budget.signal,
      }),
    );
    let result: T;
    try {
      // Also bound and detach custom transport results; accessors/shared objects are not evidence.
      result = request.parse(JSON.parse(syncJsonSnapshot(raw, request.maximum)));
    } catch {
      budget.check();
      throw failure('GATEWAY_RESPONSE_INVALID', trace, kind);
    }
    budget.check();
    return result;
  } catch (error) {
    let finalError = error;
    try {
      budget.check();
    } catch (stopped) {
      finalError = stopped;
    }
    const envelope = finalError instanceof ContractError ? finalError.envelope : undefined;
    throw failure(
      envelope?.trace_id === trace && Object.hasOwn(messages, envelope.code)
        ? envelope.code
        : 'GATEWAY_UNAVAILABLE',
      trace,
      kind,
    );
  } finally {
    budget.close();
  }
}

export function readArtifactMetadata(
  transport: WcpTransport,
  context: RequestContext,
  input: unknown,
  options: WcpArtifactReadOptions,
) {
  return read(transport, context, options, 'metadata', (snapshot) => {
    const query = parseArtifactReadQuery(JSON.parse(syncJsonSnapshot(input, 4096)));
    return {
      path:
        '/v1/artifacts/' +
        encodeURIComponent(query.artifact_id) +
        (query.version === undefined ? '' : '/versions/' + query.version),
      maximum: METADATA_BYTES,
      expected: {
        ...(snapshot.actor_id === undefined ? {} : { actor_id: snapshot.actor_id }),
        ...(snapshot.client_id === undefined ? {} : { client_id: snapshot.client_id }),
      },
      parse: (raw: unknown) => parseArtifactReadEnvelope(raw, query, snapshot, snapshot.trace_id),
    };
  });
}

export function readArtifactReceipt(
  transport: WcpTransport,
  context: RequestContext,
  input: ArtifactReceiptQuery,
  options: WcpArtifactReadOptions,
) {
  return read(transport, context, options, 'receipt', (snapshot) => {
    const query = parseArtifactReceiptQuery(
      JSON.parse(syncJsonSnapshot(input, ARTIFACT_UPLOAD_REQUEST_BYTES)),
    );
    assertArtifactReceiptIdentity(query.identity, {
      ...snapshot,
      actor_id: snapshot.actor_id ?? query.identity.actor_id,
      client_id: snapshot.client_id ?? query.identity.client_id,
    });
    // Parsed body and validation expectation are separate, including nested source references.
    const body = parseArtifactReceiptQuery(
      JSON.parse(syncJsonSnapshot(query, ARTIFACT_UPLOAD_REQUEST_BYTES)),
    );
    return {
      path: '/v1/artifacts/receipt',
      maximum: RECEIPT_BYTES,
      expected: { actor_id: query.identity.actor_id, client_id: query.identity.client_id },
      body,
      parse: (raw: unknown) => parseArtifactReceiptEnvelope(raw, query, snapshot.trace_id),
    };
  });
}

export function readArtifactVersions(
  transport: WcpTransport,
  context: RequestContext,
  input: ArtifactVersionsQuery,
  options: WcpArtifactReadOptions,
) {
  return read(transport, context, options, 'versions', (snapshot) => {
    const query = parseArtifactVersionsQuery(input);
    const parameters = new URLSearchParams({ limit: String(query.limit) });
    if (query.at_version !== undefined) parameters.set('at_version', String(query.at_version));
    if (query.before_version !== undefined)
      parameters.set('before_version', String(query.before_version));
    return {
      path:
        '/v1/artifacts/' +
        encodeURIComponent(query.artifact_id) +
        '/versions?' +
        parameters.toString(),
      maximum: ARTIFACT_VERSIONS_RESPONSE_BYTES,
      expected: {
        ...(snapshot.actor_id === undefined ? {} : { actor_id: snapshot.actor_id }),
        ...(snapshot.client_id === undefined ? {} : { client_id: snapshot.client_id }),
      },
      parse: (raw: unknown) =>
        parseArtifactVersionsEnvelope(raw, query, snapshot, snapshot.trace_id),
    };
  });
}

export function readArtifactRegistry(
  transport: WcpTransport,
  context: RequestContext,
  input: ArtifactRegistryQuery,
  options: WcpArtifactReadOptions,
) {
  return read(transport, context, options, 'registry', (snapshot) => {
    const query = parseArtifactRegistryQuery(input);
    const parameters = new URLSearchParams({ limit: String(query.limit) });
    if (query.query !== undefined) parameters.set('query', query.query);
    if (query.classification !== undefined) parameters.set('classification', query.classification);
    if (query.cursor !== undefined) parameters.set('cursor', query.cursor);
    return {
      path: '/v1/artifacts?' + parameters.toString(),
      maximum: ARTIFACT_REGISTRY_RESPONSE_BYTES,
      expected: {
        ...(snapshot.actor_id === undefined ? {} : { actor_id: snapshot.actor_id }),
        ...(snapshot.client_id === undefined ? {} : { client_id: snapshot.client_id }),
      },
      parse: (raw: unknown) =>
        parseArtifactRegistryEnvelope(raw, query, snapshot, snapshot.trace_id),
    };
  });
}
