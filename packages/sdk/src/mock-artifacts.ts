import {
  ARTIFACT_DOWNLOAD_MAX_BYTES,
  ARTIFACT_UPLOAD_REQUEST_BYTES,
  ARTIFACT_VERSIONS_RESPONSE_BYTES,
  ARTIFACT_REGISTRY_RESPONSE_BYTES,
  ContractError,
  assertArtifactReceiptIdentity,
  buildEtag,
  createUlid,
  encodeArtifactRegistryCursor,
  foldArtifactRegistryQuery,
  isUlid,
  parseArtifactCommandIdentity,
  parseArtifactDownloadHeaders,
  parseArtifactDownloadMetadata,
  parseArtifactDownloadQuery,
  parseArtifactMetadataView,
  parseArtifactReadEnvelope,
  parseArtifactReadQuery,
  parseArtifactReceiptEnvelope,
  parseArtifactReceiptQuery,
  parseArtifactRegistryCursor,
  parseArtifactRegistryEnvelope,
  parseArtifactRegistryQuery,
  parseArtifactUploadContextEnvelope,
  parseArtifactUploadEnvelope,
  parseArtifactVersionsEnvelope,
  parseArtifactVersionsQuery,
  parseArtifactVersionSummary,
  summarizeArtifactVersion,
  syncJsonSnapshot,
  type ArtifactCommandIdentity,
  type ArtifactDownloadQuery,
  type ArtifactMetadataView,
  type ArtifactReceiptQuery,
  type ArtifactRegistryQuery,
  type ArtifactRegistryItem,
  type ArtifactVersionsQuery,
} from '@planemem/contracts';
import type { WcpBinaryResponse, WcpRequest, WcpTransport } from './client.js';

const UPLOAD_BYTES = 16 * 1024 * 1024;
const STORE_BYTES = 64 * 1024 * 1024;
const RESPONSE_BYTES = 2 * 1024 * 1024;
const RELEASE_BYTES = 16 * 1024 * 1024;
const configurationTrace = 'trace_mock_artifact_configuration';

/** An initially empty project store; limits describe this development Mock only. */
export interface MockArtifactSeed {
  scope: Pick<ArtifactCommandIdentity, 'tenant_id' | 'workspace_id' | 'project_id'>;
  max_upload_bytes?: number;
  max_download_bytes?: number;
}
/** These configured decisions simulate export capabilities and policy; they are not credentials. */
export interface MockArtifactDownloadAccess {
  export_data: boolean;
  export_restricted: boolean;
  policy_allowed: boolean;
}
/** Local development observation only, never a durable audit or client delivery receipt. */
export interface MockArtifactDownloadRelease {
  schema_version: 1;
  simulation: true;
  audit_id: string;
  phase: 'release';
  identity: ArtifactCommandIdentity;
  artifact: ArtifactMetadataView;
  trace_id: string;
  occurred_at: string;
}
/** Fixed simulated permissions, never inferred from headers or uploaded identity. */
export interface MockArtifactSession {
  identity: ArtifactCommandIdentity;
  expires_at: string;
  project_readable: boolean;
  read_artifacts: boolean;
  write_artifacts: boolean;
  read_restricted: boolean;
  download_access?: MockArtifactDownloadAccess;
}
type Version = { metadata: ArtifactMetadataView; content: Uint8Array };
type History = { current: Version; versions: Map<number, Version> };
type Receipt = { fingerprint: string; metadata: ArtifactMetadataView };

function fail(code: string, trace: string): never {
  throw new ContractError(code, 'Simulated artifact request failed: ' + code, {
    trace_id: trace,
    retryable: false,
  });
}
function checked<T>(code: string, trace: string, read: () => T): T {
  try {
    return read();
  } catch {
    return fail(code, trace);
  }
}
function snapshot(value: unknown, maximum: number): unknown {
  return JSON.parse(syncJsonSnapshot(value, maximum));
}
function record(value: unknown, required: string[], optional: string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (
    required.some((key) => !Object.hasOwn(row, key)) ||
    Object.keys(row).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new TypeError();
  return row;
}
function receiptKey(query: ArtifactReceiptQuery) {
  return JSON.stringify([
    query.identity.actor_id,
    query.identity.client_id,
    query.command.request_key,
  ]);
}
function source(metadata: ArtifactMetadataView) {
  return [{ type: 'artifact', id: metadata.artifact_id, revision: metadata.version }];
}
export function isMockArtifactPath(path: string) {
  const name = typeof path === 'string' ? path.split('?')[0] : '';
  return name === '/v1/artifacts' || name?.startsWith('/v1/artifacts/') === true;
}

/** Ephemeral upload/history simulation; no object storage, audit or database access. */
export class MockArtifactStore {
  readonly #scope: MockArtifactSeed['scope'];
  readonly #maximum: number;
  readonly #downloadMaximum: number;
  readonly #artifacts = new Map<string, History>();
  readonly #receipts = new Map<string, Receipt>();
  readonly #releases = new Map<string, MockArtifactDownloadRelease>();
  #bytes = 0;
  #activeUploads = 0;
  #activeDownloads = 0;
  #activeRegistryReads = 0;
  #releaseBytes = 0;

  constructor(seed: MockArtifactSeed) {
    const saved = checked('MOCK_ARTIFACT_CONFIGURATION_INVALID', configurationTrace, () => {
      const input = record(
        snapshot(seed, 16 * 1024),
        ['scope'],
        ['max_upload_bytes', 'max_download_bytes'],
      );
      const scope = record(input.scope, ['tenant_id', 'workspace_id', 'project_id']);
      const identity = parseArtifactCommandIdentity({
        ...scope,
        actor_id: 'mock',
        client_id: 'mock',
      });
      const maximum = input.max_upload_bytes === undefined ? UPLOAD_BYTES : input.max_upload_bytes;
      if (
        typeof maximum !== 'number' ||
        !Number.isSafeInteger(maximum) ||
        maximum < 0 ||
        maximum > UPLOAD_BYTES
      )
        throw new TypeError();
      const downloadMaximum =
        input.max_download_bytes === undefined ? UPLOAD_BYTES : input.max_download_bytes;
      if (
        typeof downloadMaximum !== 'number' ||
        !Number.isSafeInteger(downloadMaximum) ||
        downloadMaximum < 0 ||
        downloadMaximum > UPLOAD_BYTES
      )
        throw new TypeError();
      return {
        scope: {
          tenant_id: identity.tenant_id,
          workspace_id: identity.workspace_id,
          project_id: identity.project_id,
        },
        maximum,
        downloadMaximum,
      };
    });
    this.#scope = saved.scope;
    this.#maximum = saved.maximum;
    this.#downloadMaximum = saved.downloadMaximum;
  }

  connect(session: MockArtifactSession): WcpTransport {
    const saved = checked(
      'MOCK_ARTIFACT_CONFIGURATION_INVALID',
      configurationTrace,
      (): MockArtifactSession => {
        const input = record(
          snapshot(session, 16 * 1024),
          [
            'identity',
            'expires_at',
            'project_readable',
            'read_artifacts',
            'write_artifacts',
            'read_restricted',
          ],
          ['download_access'],
        );
        const identity = parseArtifactCommandIdentity(input.identity);
        for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
          if (identity[field] !== this.#scope[field]) throw new TypeError();
        if (
          typeof input.expires_at !== 'string' ||
          !Number.isFinite(Date.parse(input.expires_at)) ||
          new Date(input.expires_at).toISOString() !== input.expires_at
        )
          throw new TypeError();
        for (const key of [
          'project_readable',
          'read_artifacts',
          'write_artifacts',
          'read_restricted',
        ])
          if (typeof input[key] !== 'boolean') throw new TypeError();
        let downloadAccess: MockArtifactDownloadAccess | undefined;
        if (input.download_access !== undefined) {
          const access = record(input.download_access, [
            'export_data',
            'export_restricted',
            'policy_allowed',
          ]);
          if (Object.values(access).some((value) => typeof value !== 'boolean'))
            throw new TypeError();
          downloadAccess = {
            export_data: access.export_data as boolean,
            export_restricted: access.export_restricted as boolean,
            policy_allowed: access.policy_allowed as boolean,
          };
        }
        return {
          identity,
          expires_at: input.expires_at,
          project_readable: input.project_readable as boolean,
          read_artifacts: input.read_artifacts as boolean,
          write_artifacts: input.write_artifacts as boolean,
          read_restricted: input.read_restricted as boolean,
          ...(downloadAccess ? { download_access: downloadAccess } : {}),
        };
      },
    );
    return {
      request: async <T = unknown>(request: WcpRequest): Promise<T> =>
        (await this.respond(request, saved)) as T,
    };
  }

  /** Trusted store-owner inspection, not a public authenticated WCP audit endpoint. */
  getDownloadRelease(auditId: string): MockArtifactDownloadRelease | undefined {
    if (!isUlid(auditId)) fail('INVALID_INPUT', configurationTrace);
    const saved = this.#releases.get(auditId);
    return saved === undefined
      ? undefined
      : (snapshot(saved, RESPONSE_BYTES) as MockArtifactDownloadRelease);
  }

  private async download(
    query: ArtifactDownloadQuery,
    session: MockArtifactSession,
    maximum: number,
    trace: string,
    live: () => void,
  ): Promise<WcpBinaryResponse> {
    const access = session.download_access;
    if (!access) fail('ARTIFACT_ACCESS_DENIED', trace);
    if (query.size > this.#downloadMaximum || query.size > maximum)
      fail('ARTIFACT_TOO_LARGE', trace);
    if (this.#activeDownloads >= 2) fail('ARTIFACT_DOWNLOAD_BUSY', trace);
    this.#activeDownloads++;
    try {
      const authorize = (artifact: ArtifactMetadataView) => {
        const classification = artifact.classification;
        const canExport =
          classification === 'public' ||
          access.export_restricted ||
          (classification !== 'restricted' && access.export_data);
        if (
          !access.policy_allowed ||
          !canExport ||
          (classification === 'restricted' && !session.read_restricted)
        )
          fail('ARTIFACT_ACCESS_DENIED', trace);
      };
      const select = () => {
        live();
        const history = this.current(query.artifact_id, session, trace);
        const selected = history.versions.get(query.version);
        if (!selected) fail('ARTIFACT_VERSION_NOT_FOUND', trace);
        checked('ARTIFACT_DESCRIPTOR_CONFLICT', trace, () =>
          parseArtifactDownloadMetadata(selected.metadata, query, this.#scope),
        );
        authorize(history.current.metadata);
        authorize(selected.metadata);
        return selected;
      };
      const selected = select();
      if (selected.content.byteLength !== query.size) fail('ARTIFACT_STORED_INVALID', trace);
      if (typeof globalThis.crypto?.subtle?.digest !== 'function')
        fail('ARTIFACT_INTEGRITY_UNAVAILABLE', trace);
      // Hash a detached copy; returned content can never mutate the stored version.
      const content = new Uint8Array(selected.content);
      const digest = new Uint8Array(
        await globalThis.crypto.subtle.digest('SHA-256', content.buffer),
      );
      if (select() !== selected) fail('ARTIFACT_STORED_INVALID', trace);
      if (
        Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('') !== query.sha256
      )
        fail('ARTIFACT_STORED_INVALID', trace);
      const artifact = selected.metadata;
      const auditId = createUlid();
      if (this.#releases.has(auditId)) fail('MOCK_ARTIFACT_ID_COLLISION', trace);
      const headers: Record<string, string> = {
        'content-type': 'application/octet-stream',
        'content-length': String(content.byteLength),
        'content-disposition': `attachment; filename="${artifact.artifact_id}-v${artifact.version}.bin"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'accept-ranges': 'none',
        'x-wcp-schema-version': '1',
        'x-trace-id': trace,
        'x-tenant-id': encodeURIComponent(artifact.tenant_id),
        'x-workspace-id': encodeURIComponent(artifact.workspace_id),
        'x-project-id': encodeURIComponent(artifact.project_id),
        'x-artifact-id': artifact.artifact_id,
        'x-artifact-version': String(artifact.version),
        'x-artifact-sha256': artifact.sha256,
        'x-artifact-audit-id': auditId,
        'x-artifact-audit-stage': 'release',
      };
      checked('GATEWAY_RESPONSE_INVALID', trace, () =>
        parseArtifactDownloadHeaders(headers, artifact, trace),
      );
      const release: MockArtifactDownloadRelease = {
        schema_version: 1,
        simulation: true,
        audit_id: auditId,
        phase: 'release',
        identity: session.identity,
        artifact,
        trace_id: trace,
        occurred_at: new Date().toISOString(),
      };
      const serialized = checked('GATEWAY_RESPONSE_INVALID', trace, () =>
        syncJsonSnapshot(release, RESPONSE_BYTES),
      );
      const bytes = new TextEncoder().encode(serialized).byteLength;
      if (this.#releases.size >= 1000 || this.#releaseBytes + bytes > RELEASE_BYTES)
        fail('RATE_LIMITED', trace);
      const saved = JSON.parse(serialized) as MockArtifactDownloadRelease;
      const result: WcpBinaryResponse = { status: 200, headers, content };
      live();
      // No await between recording the simulated release and handing back its copied bytes.
      this.#releases.set(auditId, saved);
      this.#releaseBytes += bytes;
      return result;
    } finally {
      this.#activeDownloads--;
    }
  }

  private current(id: string, session: MockArtifactSession, trace: string): History {
    const value = this.#artifacts.get(id);
    if (
      !value ||
      (value.current.metadata.classification === 'restricted' && !session.read_restricted)
    )
      return fail('ARTIFACT_NOT_FOUND', trace);
    return value;
  }
  private previous(query: ArtifactReceiptQuery, session: MockArtifactSession, trace: string) {
    const receipt = this.#receipts.get(receiptKey(query));
    if (receipt) {
      if (receipt.fingerprint !== JSON.stringify(query.command))
        fail('IDEMPOTENCY_KEY_REUSED', trace);
      this.current(receipt.metadata.artifact_id, session, trace);
    }
    return receipt;
  }

  private listVersions(
    query: ArtifactVersionsQuery & { limit: number },
    session: MockArtifactSession,
    trace: string,
  ) {
    const history = this.current(query.artifact_id, session, trace);
    const metadata = (stored: Version, version: number) => {
      const artifact = checked('ARTIFACT_STORED_INVALID', trace, () => {
        const value = parseArtifactMetadataView(snapshot(stored.metadata, RESPONSE_BYTES));
        if (
          value.artifact_id !== query.artifact_id ||
          value.version !== version ||
          value.tenant_id !== this.#scope.tenant_id ||
          value.workspace_id !== this.#scope.workspace_id ||
          value.project_id !== this.#scope.project_id
        )
          throw new TypeError();
        return value;
      });
      if (artifact.classification === 'restricted' && !session.read_restricted)
        fail('ARTIFACT_ACCESS_DENIED', trace);
      return artifact;
    };
    const current = metadata(history.current, history.current.metadata.version);
    if (history.versions.get(current.version) !== history.current)
      fail('ARTIFACT_STORED_INVALID', trace);
    const ceiling = query.at_version ?? current.version;
    if (ceiling > current.version) fail('INVALID_INPUT', trace);
    // The store already caps all saved versions at 1000; only selected metadata is copied.
    const selected = Array.from(history.versions.keys())
      .filter(
        (version) =>
          version <= ceiling &&
          (query.before_version === undefined || version < query.before_version),
      )
      .sort((a, b) => b - a)
      .slice(0, query.limit + 1)
      .map((version) =>
        summarizeArtifactVersion(metadata(history.versions.get(version)!, version)),
      );
    const hasMore = selected.length > query.limit;
    const items = selected.slice(0, query.limit);
    return checked('ARTIFACT_STORED_INVALID', trace, () =>
      parseArtifactVersionsEnvelope(
        {
          schema_version: 1,
          trace_id: trace,
          source_refs: [{ type: 'artifact', id: query.artifact_id }],
          data: {
            ...this.#scope,
            query,
            snapshot_version: ceiling,
            items,
            has_more: hasMore,
            next_query: hasMore
              ? {
                  artifact_id: query.artifact_id,
                  limit: query.limit,
                  at_version: ceiling,
                  before_version: items[items.length - 1]!.version,
                }
              : null,
            content_state: 'not-checked',
          },
        },
        query,
        this.#scope,
        trace,
      ),
    );
  }

  private async listArtifacts(
    query: ArtifactRegistryQuery & { limit: number },
    session: MockArtifactSession,
    trace: string,
    live: () => void,
  ) {
    if (query.classification === 'restricted' && !session.read_restricted)
      fail('ARTIFACT_ACCESS_DENIED', trace);
    if (this.#activeRegistryReads >= 2) fail('RATE_LIMITED', trace);
    this.#activeRegistryReads++;
    try {
      live();
      // Keep the same binding as the persistent reader; this digest is not an authorization token.
      const binding = JSON.stringify([
        'artifact-registry-v1',
        session.identity.tenant_id,
        session.identity.workspace_id,
        session.identity.project_id,
        session.identity.actor_id,
        session.identity.client_id,
        session.read_restricted,
        query.query ?? null,
        query.classification ?? null,
        query.limit,
      ]);
      let key: string;
      try {
        const digest = await globalThis.crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(binding),
        );
        key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
          '',
        );
      } catch {
        live();
        return fail('ARTIFACT_INTEGRITY_UNAVAILABLE', trace);
      }
      live();
      const before = checked('INVALID_INPUT', trace, () => {
        if (query.cursor === undefined) return undefined;
        const cursor = parseArtifactRegistryCursor(query.cursor);
        if (cursor.key !== key) throw new TypeError();
        return cursor.artifact_id;
      });
      // No awaits while selecting a page. All filter fields come from this store's checked uploads.
      // Only selected/lookahead records are fully copied; the store caps all saved versions at 1000.
      const selected: ArtifactRegistryItem[] = [];
      const search = query.query === undefined ? undefined : foldArtifactRegistryQuery(query.query);
      const ids = Array.from(this.#artifacts.keys()).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
      for (const id of ids) {
        if (before !== undefined && id >= before) continue;
        const history = this.#artifacts.get(id)!;
        const stored = history.current;
        if (
          (stored.metadata.classification === 'restricted' && !session.read_restricted) ||
          (query.classification !== undefined &&
            stored.metadata.classification !== query.classification) ||
          (search !== undefined &&
            !foldArtifactRegistryQuery(stored.metadata.name).includes(search))
        )
          continue;
        const artifact = checked('ARTIFACT_STORED_INVALID', trace, () => {
          const value = parseArtifactMetadataView(snapshot(stored.metadata, RESPONSE_BYTES));
          if (
            value.artifact_id !== id ||
            value.tenant_id !== this.#scope.tenant_id ||
            value.workspace_id !== this.#scope.workspace_id ||
            value.project_id !== this.#scope.project_id ||
            history.versions.get(value.version) !== stored
          )
            throw new TypeError();
          return {
            artifact_id: value.artifact_id,
            ...parseArtifactVersionSummary(summarizeArtifactVersion(value)),
          };
        });
        selected.push(artifact);
        if (selected.length > query.limit) break;
      }
      const items = selected.slice(0, query.limit);
      const hasMore = selected.length > query.limit;
      const result = checked('ARTIFACT_STORED_INVALID', trace, () =>
        parseArtifactRegistryEnvelope(
          {
            schema_version: 1,
            trace_id: trace,
            source_refs: items.map((item) => ({ type: 'artifact', id: item.artifact_id })),
            data: {
              ...this.#scope,
              query,
              items,
              has_more: hasMore,
              next_query: hasMore
                ? {
                    ...query,
                    cursor: encodeArtifactRegistryCursor(key, items[items.length - 1]!.artifact_id),
                  }
                : null,
              content_state: 'not-checked',
            },
          },
          query,
          this.#scope,
          trace,
        ),
      );
      live();
      return result;
    } finally {
      this.#activeRegistryReads--;
    }
  }

  private async respond(raw: WcpRequest, session: MockArtifactSession): Promise<unknown> {
    // Capture every mutable request property before multipart parsing or hashing can yield.
    const { method, path, body, response_type, max_response_bytes, signal } = raw;
    let trace = 'trace_unknown';
    const headers = checked('INVALID_INPUT', trace, () => {
      const row = snapshot(raw.headers, 16 * 1024);
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError();
      const map = new Map<string, string>();
      for (const [key, value] of Object.entries(row)) {
        if (typeof value !== 'string' || map.has(key.toLowerCase())) throw new TypeError();
        map.set(key.toLowerCase(), value);
      }
      return map;
    });
    const supplied = headers.get('x-trace-id') ?? headers.get('traceparent');
    if (
      !supplied?.trim() ||
      supplied.length > 1024 ||
      /[\u0000-\u001f\u007f\p{Cs}]/u.test(supplied)
    )
      fail('INVALID_INPUT', trace);
    trace = supplied;
    const live = () => {
      if (signal?.aborted) fail('GATEWAY_REQUEST_CANCELED', trace);
      if (Date.parse(session.expires_at) <= Date.now()) fail('DENIED', trace);
    };
    live();
    for (const [header, field] of [
      ['x-tenant-id', 'tenant_id'],
      ['x-workspace-id', 'workspace_id'],
      ['x-project-id', 'project_id'],
    ] as const)
      if (headers.get(header) !== session.identity[field]) fail('ARTIFACT_ACCESS_DENIED', trace);
    for (const [header, field] of [
      ['x-expected-actor-id', 'actor_id'],
      ['x-expected-client-id', 'client_id'],
    ] as const)
      if (headers.has(header) && headers.get(header) !== session.identity[field])
        fail('ARTIFACT_ACCESS_DENIED', trace);
    if (
      typeof path !== 'string' ||
      path.length > 8192 ||
      path.includes('#') ||
      /[\u0000-\u001f\u007f]/.test(path)
    )
      fail('INVALID_INPUT', trace);
    const registry = method === 'GET' ? /^\/v1\/artifacts(?:\?(.*))?$/.exec(path) : null;
    if (!registry && path.length > 512) fail('INVALID_INPUT', trace);
    const directory =
      method === 'GET'
        ? /^\/v1\/artifacts\/([0-9A-HJKMNP-TV-Z]{26})\/versions(?:\?(.*))?$/.exec(path)
        : null;
    if (path.includes('?') && !directory && !registry) fail('INVALID_INPUT', trace);
    const registryQuery = registry
      ? checked('INVALID_INPUT', trace, () => {
          const params = new URLSearchParams(registry[1] ?? '');
          const input: Record<string, unknown> = {};
          for (const [field, value] of params) {
            if (
              !['query', 'classification', 'limit', 'cursor'].includes(field) ||
              params.getAll(field).length !== 1
            )
              throw new TypeError();
            if (field === 'limit') {
              if (!/^[1-9][0-9]{0,15}$/.test(value) || !Number.isSafeInteger(Number(value)))
                throw new TypeError();
              input[field] = Number(value);
            } else input[field] = value;
          }
          return parseArtifactRegistryQuery(input);
        })
      : undefined;
    const versionsQuery = directory
      ? checked('INVALID_INPUT', trace, () => {
          const params = new URLSearchParams(directory[2] ?? '');
          const input: Record<string, unknown> = { artifact_id: directory[1] };
          for (const [field, value] of params) {
            if (
              !['limit', 'at_version', 'before_version'].includes(field) ||
              params.getAll(field).length !== 1 ||
              !/^[1-9][0-9]{0,15}$/.test(value) ||
              !Number.isSafeInteger(Number(value))
            )
              throw new TypeError();
            input[field] = Number(value);
          }
          return parseArtifactVersionsQuery(input);
        })
      : undefined;
    const context = path === '/v1/artifacts/upload-context';
    const receiptRoute = path === '/v1/artifacts/receipt';
    const collection = path === '/v1/artifacts';
    const append = /^\/v1\/artifacts\/([0-9A-HJKMNP-TV-Z]{26})\/versions$/.exec(path);
    const read =
      /^\/v1\/artifacts\/([0-9A-HJKMNP-TV-Z]{26})(?:\/versions\/([1-9][0-9]{0,15}))?$/.exec(path);
    const download =
      /^\/v1\/artifacts\/([0-9A-HJKMNP-TV-Z]{26})\/versions\/([1-9][0-9]{0,15})\/content$/.exec(
        path,
      );
    const upload = (collection && !registry) || (!!append && !directory);
    if (
      (!context && !receiptRoute && !upload && !read && !download && !directory && !registry) ||
      method !== (upload || receiptRoute ? 'POST' : 'GET')
    )
      fail('MOCK_ROUTE_NOT_FOUND', trace);
    if (
      (method === 'GET' && body !== undefined) ||
      (!upload && ['idempotency-key', 'if-match'].some((key) => headers.has(key))) ||
      [
        'x-expected-version',
        'if-match-version',
        'if-none-match',
        'if-modified-since',
        'if-unmodified-since',
        'range',
        'if-range',
        'content-encoding',
      ].some((key) => headers.has(key))
    )
      fail('INVALID_INPUT', trace);
    if (
      (directory || registry) &&
      (headers.has('transfer-encoding') ||
        (headers.has('content-length') && headers.get('content-length') !== '0'))
    )
      fail('INVALID_INPUT', trace);
    if (download) {
      if (!session.read_artifacts) fail('ARTIFACT_ACCESS_DENIED', trace);
      if (!session.project_readable) fail('ARTIFACT_NOT_FOUND', trace);
      if (
        response_type !== 'bytes' ||
        typeof max_response_bytes !== 'number' ||
        !Number.isSafeInteger(max_response_bytes) ||
        max_response_bytes < 0 ||
        max_response_bytes > ARTIFACT_DOWNLOAD_MAX_BYTES ||
        headers.has('transfer-encoding') ||
        (headers.has('content-length') && headers.get('content-length') !== '0')
      )
        fail('INVALID_INPUT', trace);
      const query = checked('INVALID_INPUT', trace, () => {
        const size = headers.get('x-expected-artifact-size');
        if (typeof size !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(size)) throw new TypeError();
        return parseArtifactDownloadQuery({
          artifact_id: download[1],
          version: Number(download[2]),
          sha256: headers.get('x-expected-artifact-sha256'),
          size: Number(size),
        });
      });
      return this.download(query, session, max_response_bytes, trace, live);
    }
    const maximum = max_response_bytes ?? RESPONSE_BYTES;
    if (
      !Number.isSafeInteger(maximum) ||
      maximum < 1 ||
      (response_type !== undefined &&
        response_type !== 'json' &&
        response_type !== 'bounded-json') ||
      (response_type === 'bounded-json' && max_response_bytes === undefined)
    )
      fail('INVALID_INPUT', trace);
    const finish = (value: unknown) => {
      const detached = checked('GATEWAY_RESPONSE_INVALID', trace, () =>
        snapshot(
          value,
          Math.min(
            maximum,
            registry
              ? ARTIFACT_REGISTRY_RESPONSE_BYTES
              : directory
                ? ARTIFACT_VERSIONS_RESPONSE_BYTES
                : RESPONSE_BYTES,
          ),
        ),
      );
      live();
      return detached;
    };
    const envelope = (data: unknown, source_refs: unknown[] = []) => ({
      schema_version: 1,
      trace_id: trace,
      source_refs,
      data,
    });
    if (context || receiptRoute || upload) {
      if (!session.write_artifacts) fail('ARTIFACT_ACCESS_DENIED', trace);
    } else if (!session.read_artifacts) fail('ARTIFACT_ACCESS_DENIED', trace);
    if (context)
      return finish(
        parseArtifactUploadContextEnvelope(
          envelope({
            identity: session.identity,
            expires_at: session.expires_at,
            max_bytes: this.#maximum,
            can_read: session.read_artifacts,
            can_read_restricted: session.read_restricted,
          }),
          this.#scope,
          trace,
        ),
      );
    if (!session.project_readable) fail('ARTIFACT_NOT_FOUND', trace);
    if (registryQuery) return finish(await this.listArtifacts(registryQuery, session, trace, live));
    if (versionsQuery) return finish(this.listVersions(versionsQuery, session, trace));
    if (read) {
      const query = checked('INVALID_INPUT', trace, () =>
        parseArtifactReadQuery({
          artifact_id: read[1],
          ...(read[2] ? { version: Number(read[2]) } : {}),
        }),
      );
      const history = this.current(query.artifact_id, session, trace);
      const version =
        query.version === undefined ? history.current : history.versions.get(query.version);
      if (!version) fail('ARTIFACT_VERSION_NOT_FOUND', trace);
      const artifact = version.metadata;
      return finish(
        parseArtifactReadEnvelope(
          {
            ...envelope(
              {
                artifact,
                snapshot: query.version === undefined ? 'current' : 'historical',
                content_state: 'not-checked',
              },
              [{ type: 'artifact', id: query.artifact_id }],
            ),
            revision: artifact.version,
            ...(query.version === undefined ? { etag: artifact.etag } : {}),
          },
          query,
          this.#scope,
          trace,
        ),
      );
    }
    const original = (input: unknown) => {
      const query = checked('INVALID_INPUT', trace, () =>
        parseArtifactReceiptQuery(snapshot(input, ARTIFACT_UPLOAD_REQUEST_BYTES)),
      );
      checked('ARTIFACT_ACCESS_DENIED', trace, () =>
        assertArtifactReceiptIdentity(query.identity, session.identity),
      );
      return query;
    };
    if (receiptRoute) {
      const query = original(body);
      const previous = this.previous(query, session, trace);
      if (!previous && query.command.operation === 'artifact.put-version')
        this.current(query.command.artifact_id, session, trace);
      return finish(
        parseArtifactReceiptEnvelope(
          envelope(
            previous
              ? {
                  ...query,
                  status: 'recorded',
                  artifact: previous.metadata,
                  replayed: true,
                  content_state: 'not-checked',
                }
              : { ...query, status: 'not-observed' },
            previous ? source(previous.metadata) : [],
          ),
          query,
          trace,
        ),
      );
    }
    const parts = checked('INVALID_INPUT', trace, () => {
      if (
        !(body instanceof FormData) ||
        Array.from(body.keys()).length !== 2 ||
        body.getAll('request').length !== 1 ||
        body.getAll('content').length !== 1
      )
        throw new TypeError();
      const metadata = body.get('request');
      const content = body.get('content');
      if (
        !(metadata instanceof Blob) ||
        !(content instanceof Blob) ||
        metadata.type !== 'application/json'
      )
        throw new TypeError();
      return { metadata, content };
    });
    if (parts.metadata.size > ARTIFACT_UPLOAD_REQUEST_BYTES || parts.content.size > this.#maximum)
      fail('ARTIFACT_TOO_LARGE', trace);
    if (this.#activeUploads >= 2) fail('ARTIFACT_UPLOAD_BUSY', trace);
    this.#activeUploads++;
    try {
      const metadataBytes = await parts.metadata.arrayBuffer();
      live();
      const query = original(
        checked('INVALID_INPUT', trace, () =>
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadataBytes)),
        ),
      );
      const command = query.command;
      if (
        command.size !== parts.content.size ||
        headers.get('idempotency-key') !== command.request_key ||
        (collection && (command.operation !== 'artifact.create' || headers.has('if-match'))) ||
        (append &&
          (command.operation !== 'artifact.put-version' ||
            command.artifact_id !== append[1] ||
            headers.get('if-match') !== buildEtag(command.expected_version)))
      )
        fail('INVALID_INPUT', trace);
      if (
        command.operation === 'artifact.create' &&
        command.classification === 'restricted' &&
        !session.read_restricted
      )
        fail('ARTIFACT_ACCESS_DENIED', trace);
      if (typeof globalThis.crypto?.subtle?.digest !== 'function')
        fail('ARTIFACT_INTEGRITY_UNAVAILABLE', trace);
      const content = new Uint8Array(await parts.content.arrayBuffer());
      live();
      const digest = new Uint8Array(
        await globalThis.crypto.subtle.digest('SHA-256', content.buffer),
      );
      live();
      if (
        Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('') !== command.sha256
      )
        fail('ARTIFACT_HASH_MISMATCH', trace);
      // All state reads and the final commit occur synchronously after the last await.
      const previous = this.previous(query, session, trace);
      const response = (artifact: ArtifactMetadataView, replayed: boolean) =>
        finish(
          parseArtifactUploadEnvelope(
            envelope(
              {
                ...query,
                status: 'recorded',
                artifact,
                replayed,
                content_state: replayed ? 'not-checked' : 'verified-at-save',
              },
              source(artifact),
            ),
            query,
            trace,
          ),
        );
      if (previous) return response(previous.metadata, true);
      const history =
        command.operation === 'artifact.put-version'
          ? this.current(command.artifact_id, session, trace)
          : undefined;
      const current = history?.current.metadata;
      if (
        command.operation === 'artifact.put-version' &&
        current?.version !== command.expected_version
      )
        fail('ARTIFACT_VERSION_CONFLICT', trace);
      const base = command.operation === 'artifact.create' ? command : current!;
      const now = new Date().toISOString();
      const version = (current?.version ?? 0) + 1;
      const artifact = parseArtifactMetadataView({
        schema_version: 1,
        ...this.#scope,
        artifact_id: current?.artifact_id ?? createUlid(),
        name: base.name,
        mime: base.mime,
        classification: base.classification,
        source_refs: base.source_refs,
        sha256: command.sha256,
        size: command.size,
        version,
        etag: buildEtag(version),
        trace_id: trace,
        created_at: current?.created_at ?? now,
        updated_at: now,
      });
      if (!history && this.#artifacts.has(artifact.artifact_id))
        fail('MOCK_ARTIFACT_ID_COLLISION', trace);
      const key = receiptKey(query);
      const saved = { fingerprint: JSON.stringify(command), metadata: artifact };
      const bytes =
        checked(
          'ARTIFACT_TOO_LARGE',
          trace,
          () => new TextEncoder().encode(syncJsonSnapshot([key, saved], RESPONSE_BYTES)).byteLength,
        ) + content.byteLength;
      if (this.#receipts.size >= 1000 || this.#bytes + bytes > STORE_BYTES)
        fail('RATE_LIMITED', trace);
      const result = response(artifact, false);
      const stored = { metadata: artifact, content };
      const next = history ?? { current: stored, versions: new Map<number, Version>() };
      next.current = stored;
      next.versions.set(version, stored);
      this.#artifacts.set(artifact.artifact_id, next);
      this.#receipts.set(key, saved);
      this.#bytes += bytes;
      return result;
    } finally {
      this.#activeUploads--;
    }
  }
}
