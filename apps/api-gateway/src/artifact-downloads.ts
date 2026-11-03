import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { canExport, canRead } from '@planemem/auth';
import type { PolicyService } from '@planemem/policy-service';
import type { PersistentArtifactService } from '@planemem/artifact-service';
import {
  ARTIFACT_DOWNLOAD_DEFAULT_BYTES,
  ARTIFACT_DOWNLOAD_MAX_BYTES,
  ContractError,
  isUlid,
  parseArtifactDownloadQuery,
  parseArtifactDownloadMetadata,
  parseArtifactDownloadEnvelope,
  parseArtifactMetadataView,
  type ArtifactDownloadQuery,
  type ArtifactMetadataView,
} from '@planemem/contracts';
import type { CommandRouter, RequestContext } from './router.js';
import { publicArtifactMetadata } from './artifact-reads.js';
import {
  observeArtifactDownloadTransport,
  type ArtifactDownloadFailureStage,
  type ArtifactDownloadObserver,
  type ArtifactDownloadTransportOutcome,
} from './artifact-download-audit.js';

export type ArtifactContentReader = Pick<
  PersistentArtifactService,
  'getArtifact' | 'getVersion' | 'readVersion'
>;
export type ArtifactDownloadAudit = (
  context: RequestContext,
  artifact: ArtifactMetadataView,
  phase: 'release' | 'denied',
) => Promise<string>;

export class ArtifactDownloadGate {
  readonly maxBytes: number;
  private active = 0;
  constructor(maxBytes = ARTIFACT_DOWNLOAD_DEFAULT_BYTES) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > ARTIFACT_DOWNLOAD_MAX_BYTES)
      throw new RangeError('Invalid artifact download byte limit');
    this.maxBytes = maxBytes;
  }
  acquire(trace: string): () => void {
    if (this.active >= 2)
      throw new ContractError('ARTIFACT_DOWNLOAD_BUSY', 'Artifact download capacity is occupied', {
        trace_id: trace,
        retryable: true,
      });
    this.active++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
  }
}

export function registerArtifactDownloads(
  router: CommandRouter,
  reader: ArtifactContentReader | undefined,
  policy: PolicyService,
  audit: ArtifactDownloadAudit | undefined,
  maxBytes: number,
  observe?: ArtifactDownloadObserver,
) {
  router.register('artifact.download', async (request) => {
    const context = {
      ...request.context,
      capability: [...request.context.capability],
      roles: [...(request.context.roles ?? [])],
    };
    const fail = (code: string, message: string) =>
      new ContractError(code, message, { trace_id: context.trace_id });
    if (
      context.authenticated_client !== true ||
      !context.capability.includes('artifact.read') ||
      !context.token_expires_at ||
      !Number.isFinite(Date.parse(context.token_expires_at)) ||
      Date.parse(context.token_expires_at) <= Date.now()
    )
      throw fail(
        'ARTIFACT_ACCESS_DENIED',
        'A verified artifact reader with a valid session is required',
      );
    let query: ArtifactDownloadQuery;
    try {
      if (
        context.idempotency_key !== undefined ||
        context.expected_version !== undefined ||
        typeof request.input.version !== 'string' ||
        !/^[1-9][0-9]{0,15}$/.test(request.input.version) ||
        typeof request.input.size !== 'string' ||
        !/^(0|[1-9][0-9]{0,15})$/.test(request.input.size)
      )
        throw new TypeError();
      query = parseArtifactDownloadQuery({
        ...request.input,
        version: Number(request.input.version),
        size: Number(request.input.size),
      });
    } catch {
      throw fail(
        'INVALID_INPUT',
        'Supply a pinned version, expected SHA-256 and byte length without write conditions',
      );
    }
    if (query.size > maxBytes)
      throw fail('ARTIFACT_TOO_LARGE', 'Artifact exceeds the configured download limit');
    if (!reader)
      throw fail('ARTIFACT_STORAGE_UNAVAILABLE', 'Persistent artifact content is not configured');
    if (!audit)
      throw fail(
        'AUDIT_PERSISTENCE_UNAVAILABLE',
        'Artifact downloads require durable audit persistence',
      );
    const contentReader = reader;
    const auditSink = audit;
    let stage: ArtifactDownloadFailureStage = 'metadata-read';
    let rechecking = false;
    let denied = false;
    const access = () => ({
      tenant_id: context.tenant_id,
      workspace_id: context.workspace_id,
      project_id: context.project_id,
      actor_id: context.actor_id,
      client_id: context.client_id,
      trace_id: context.trace_id,
      capabilities: [...context.capability],
    });
    const recordAudit = async (artifact: ArtifactMetadataView, phase: 'release' | 'denied') => {
      try {
        const id = await auditSink(
          { ...context, capability: [...context.capability], roles: [...context.roles] },
          parseArtifactMetadataView(artifact),
          phase,
        );
        if (!isUlid(id)) throw new TypeError();
        return id;
      } catch {
        throw fail(
          'AUDIT_PERSISTENCE_UNAVAILABLE',
          'Download audit was not confirmed; no content was released',
        );
      }
    };
    const authorize = async (artifact: ArtifactMetadataView) => {
      if (
        !canRead(artifact.classification, context.capability) ||
        !canExport(artifact.classification, context.capability)
      ) {
        denied = true;
        await recordAudit(artifact, 'denied');
        throw fail(
          'ARTIFACT_ACCESS_DENIED',
          'Artifact classification cannot be exported by this reader',
        );
      }
      const input = {
        action: 'export.artifact',
        resource: {
          tenant_id: artifact.tenant_id,
          workspace_id: artifact.workspace_id,
          project_id: artifact.project_id,
          classification: artifact.classification,
        },
        context: {
          tenant_id: context.tenant_id,
          workspace_id: context.workspace_id,
          project_id: context.project_id,
          actor_id: context.actor_id,
          client_id: context.client_id,
          trace_id: context.trace_id,
          roles: [...context.roles],
          capabilities: [...context.capability],
          token_expires_at: context.token_expires_at!,
        },
      };
      if (!policy.authorize(input).allowed || !(await policy.authorizeWithOpa(input)).allowed) {
        denied = true;
        await recordAudit(artifact, 'denied');
        throw fail('ARTIFACT_ACCESS_DENIED', 'Artifact export policy denied this download');
      }
    };
    const visible = async () => {
      if (!rechecking) stage = 'metadata-read';
      const saved = await contentReader.getVersion(access(), query.artifact_id, query.version);
      if (!rechecking) stage = 'metadata-validation';
      let parsed;
      try {
        parsed = parseArtifactMetadataView(publicArtifactMetadata(saved));
      } catch {
        throw fail('ARTIFACT_STORED_INVALID', 'Selected artifact metadata is invalid');
      }
      let selected;
      if (!rechecking) stage = 'descriptor-validation';
      try {
        selected = parseArtifactDownloadMetadata(parsed, query, context);
      } catch {
        throw fail(
          'ARTIFACT_DESCRIPTOR_CONFLICT',
          'The selected version differs from the expected content descriptor',
        );
      }
      if (!rechecking) stage = 'metadata-read';
      const latest = await contentReader.getArtifact(access(), query.artifact_id);
      if (!rechecking) stage = 'metadata-validation';
      let current;
      try {
        current = parseArtifactMetadataView(publicArtifactMetadata(latest));
        if (
          current.artifact_id !== query.artifact_id ||
          current.version < query.version ||
          current.tenant_id !== context.tenant_id ||
          current.workspace_id !== context.workspace_id ||
          current.project_id !== context.project_id
        )
          throw new TypeError();
      } catch {
        throw fail('ARTIFACT_STORED_INVALID', 'Current artifact metadata is invalid');
      }
      if (!rechecking) stage = 'authorization';
      await authorize(current);
      await authorize(selected);
      return selected;
    };
    try {
      const selected = await visible();
      stage = 'storage-read';
      const saved = await contentReader.readVersion(access(), query.artifact_id, query.version);
      stage = 'content-validation';
      let bytes: Uint8Array;
      try {
        if (
          !saved ||
          saved.trace_id !== context.trace_id ||
          Object.keys(saved).some((key) => !['artifact', 'content', 'trace_id'].includes(key)) ||
          !(saved.content instanceof Uint8Array) ||
          saved.content.byteLength !== query.size
        )
          throw new TypeError();
        const metadata = parseArtifactDownloadMetadata(
          publicArtifactMetadata(saved.artifact),
          query,
          context,
        );
        if (JSON.stringify(metadata) !== JSON.stringify(selected)) throw new TypeError();
        bytes = new Uint8Array(saved.content);
        if (createHash('sha256').update(bytes).digest('hex') !== query.sha256)
          throw new TypeError();
      } catch {
        throw fail(
          'ARTIFACT_STORED_INVALID',
          'Artifact download content failed integrity validation',
        );
      }
      // Check current visibility/classification again after the object read, before audit/release.
      rechecking = true;
      stage = 'recheck';
      if (JSON.stringify(await visible()) !== JSON.stringify(selected))
        throw fail('ARTIFACT_STORED_INVALID', 'The immutable artifact snapshot changed');
      stage = 'release-audit';
      const auditId = await recordAudit(selected, 'release');
      return {
        schema_version: 1,
        trace_id: context.trace_id,
        source_refs: [{ type: 'artifact', id: query.artifact_id, revision: query.version }],
        data: {
          artifact: selected,
          content: bytes,
          audit_id: auditId,
          audit_state: 'release-recorded',
          content_state: 'verified',
        },
      };
    } catch (error) {
      // Dedicated denied records already cover policy rejections. A failed denied audit
      // still gets an optional failure observation, without claiming it was persisted.
      if (
        !denied ||
        (error instanceof ContractError && error.envelope.code === 'AUDIT_PERSISTENCE_UNAVAILABLE')
      ) {
        try {
          await observe?.(context, query, {
            kind: 'failure',
            stage: denied ? 'denied-audit' : stage,
          });
        } catch {
          // Trusted optional observers must not change the original download failure.
        }
      }
      throw error;
    }
  });
}

export function artifactDownloadDelivery(
  value: unknown,
  query: ArtifactDownloadQuery,
  context: RequestContext,
) {
  return parseArtifactDownloadEnvelope(value, query, context, context.trace_id).data;
}

/** Finish means handed to the transport; it never proves client receipt. */
export async function sendArtifactDownload(
  response: ServerResponse,
  delivery: ReturnType<typeof artifactDownloadDelivery>,
  trace: string,
): Promise<ArtifactDownloadTransportOutcome> {
  const transport = observeArtifactDownloadTransport(response);
  if (response.destroyed || response.writableFinished) return transport.completion;
  const { artifact, content, audit_id } = delivery;
  try {
    response.writeHead(200, {
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
      'x-artifact-audit-id': audit_id,
      'x-artifact-audit-stage': 'release',
    });
    response.end(content);
  } catch {
    transport.fail();
  }
  return transport.completion;
}
