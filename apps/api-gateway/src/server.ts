import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { AuditService, type AuditRecord } from '@planemem/audit-service';
import type { S3ArtifactOptions } from '@planemem/artifact-service';
import type { PolicyDecision } from '@planemem/auth';
import {
  ContractError,
  buildEtag,
  createUlid,
  parseEtag,
  serializeError,
  validateIdempotencyKey,
  type Ulid,
  type ContextPackReceipt,
  parseProjectSearchQuery,
  parseLegacySearchQuery,
  parseIndexedContextInput,
  parseHandoffClaimCommand,
  parseHandoffCreateCommand,
  parseSessionStartCommand,
  assertSessionStartIdentity,
  isUlid,
  isSyncIdentifier,
  parseArtifactDownloadQuery,
  AUDIT_EXPORT_REQUEST_BYTES,
  SYNC_EVENT_RECEIPT_REQUEST_BYTES,
  PROPOSAL_CREATE_RECEIPT_REQUEST_BYTES,
  PROPOSAL_REVIEW_RECEIPT_REQUEST_BYTES,
  CONTEXT_PACK_SAVE_RECEIPT_REQUEST_BYTES,
} from '@planemem/contracts';
import { validateEvent } from '@planemem/events';
import { PolicyService } from '@planemem/policy-service';
import {
  createMemoryService,
  type AiMemoryMcpProviderOptions,
  type MemoryProviderMode,
  type MemoryScope,
  type MemoryServiceConfiguration,
  type MemoryServiceAdapter,
} from '@planemem/context-service';
import {
  PlaneProjection,
  observedEntityKind,
  verifyWebhook,
  type WebhookHeaders,
} from '@planemem/plane-connector';
import {
  SearchService,
  PostgresProjectSearch,
  PostgresLegacySearch,
  type SearchHit,
} from '@planemem/search-service';
import { ContinuationService, SessionService } from '@planemem/session-service';
import postgres from 'postgres';
import { ApiGateway, commandReceipt, type HttpRequest } from './http.js';
import { OidcTokenVerifier } from './oidc.js';
import { WorkbenchRepository, type WorkbenchDatabase } from './workbench/repository.js';
import { queryWorkbench, WORKBENCH_QUERY_PATH } from './workbench/query.js';
import { authenticatedContext, type VerifyGatewayToken } from './authenticated-context.js';
import { CommandRouter, type CommandRequest, type RequestContext } from './router.js';
import { PostgresPlaneInbox, type PlaneDeliveryResult } from './plane-inbox.js';
import { registerPlaneInboxReads } from './plane-inbox-reads.js';
import { registerPlaneInboxRetries } from './plane-inbox-retry.js';
import { PostgresPlaneInboxMetrics } from './plane-inbox-metrics.js';
import { PostgresSessionStore, withSessionTransaction } from './session-persistence.js';
import { PostgresSessionCurrentStore } from './session-current-persistence.js';
import { SessionOriginBridge, type SessionOriginAuthority } from './session-origin-bridge.js';
import { PostgresSessionOriginStore } from './session-origin-persistence.js';
import { SessionCurrentIdentityScope, type SessionCurrentOpaOptions } from './session-current-authority.js';
import { parseSessionCurrentRequest, registerSessionCurrentRoute, SessionCurrentReader,
  sessionCurrentOperation, sessionCurrentPath, type SessionCurrentAuthority,
  type SessionCurrentConfiguration } from './session-current.js';
import { persistConflictDecision } from './conflict-persistence.js';
import { registerConflictRead } from './conflict-read.js';
import { readConflictRegistry } from './conflict-registry.js';
import { registerConflictReceipts, canReadConflictReceipt } from './conflict-receipts.js';
import { registerConflictCommandContext } from './conflict-command-context.js';
import { registerSyncCommandContext, canReadSyncCommandContext } from './sync-command-context.js';
import { registerSyncEventReceipt } from './sync-event-receipt.js';
import { appendUploadBatch } from './sync-upload.js';
import { readSyncChanges, withSyncDatabase } from './sync-persistence.js';
import { registerSyncCursor } from './sync-cursor.js';
import { canReadSyncStream } from './sync-reader.js';
import { parseSyncChangesQuery, parseSyncChangesEnvelope } from '@planemem/contracts';
import { mcpToolRequiresClient } from './mcp/catalog.js';
import { requestedAuditSession } from './audit-session-target.js';
import {
  canUploadArtifactTool,
  isArtifactUploadTool,
  MCP_ARTIFACT_UPLOAD_BODY_BYTES,
} from './mcp/artifact-upload.js';
import { MCP_JSON_BODY_BYTES, readMcpJson } from './mcp/body.js';
import { MCP_SYNC_HTTP_BYTES } from './mcp/sync-reads.js';
import { MCP_PROPOSAL_RECEIPT_HTTP_BYTES } from './mcp/proposal-create-receipt.js';
import { dispatchMcp, rpcError, MCP_PROTOCOL_VERSIONS } from './mcp/protocol.js';
import { registerMcpReads, resourceKey, type RuntimeResource } from './mcp/reads.js';
import { registerContextPacks, withSavedContextPack } from './context-packs.js';
import { registerContextPackDirectory } from './context-pack-directory.js';
import {
  registerContextPackSaveReceipt,
  canReadContextPackSaveReceipt,
  validateContextPackSaveReceiptHeaders,
} from './context-pack-save-receipt.js';
import {
  canReadContextPackSaveContext,
  registerContextPackSaveContext,
  validateContextPackSaveContextHeaders,
} from './context-pack-save-context.js';
import { registerCheckpointReceipts } from './checkpoint-receipts.js';
import { registerCheckpointRead } from './checkpoint-read.js';
import { registerCheckpointHistory } from './checkpoint-history.js';
import { registerArtifactReads, type ArtifactMetadataReader } from './artifact-reads.js';
import { registerArtifactVersions, type ArtifactVersionReader } from './artifact-versions.js';
import { registerArtifactRegistry, type ArtifactRegistryReader } from './artifact-registry.js';
import { registerArtifactReceipts, type ArtifactReceiptReader } from './artifact-receipts.js';
import { registerArtifactWrites, type ArtifactWriter } from './artifact-writes.js';
import { ArtifactUploadGate, readArtifactUpload } from './artifact-upload.js';
import { registerArtifactUploadContext } from './artifact-upload-context.js';
import { registerAuditExport, type AuditExportAudit } from './audit-export.js';
import {
  registerArtifactDownloads,
  ArtifactDownloadGate,
  artifactDownloadDelivery,
  sendArtifactDownload,
  type ArtifactContentReader,
  type ArtifactDownloadAudit,
} from './artifact-downloads.js';
import {
  boundedArtifactDownloadObserver,
  observeArtifactDownloadTransport,
  type ArtifactDownloadObserver,
} from './artifact-download-audit.js';
import { createS3PersistentArtifactService } from './artifact-persistence.js';
import { registerHandoffRead } from './handoff-read.js';
import { registerResumeReceipts } from './resume-receipts.js';
import { registerHandoffClaimReceipts } from './handoff-claim-receipts.js';
import { registerHandoffCreateReceipts } from './handoff-create-receipts.js';
import { registerSessionStartReceipts } from './session-start-receipts.js';
import {
  registerSessionCommandContext,
  canReadSessionCommandContext,
} from './session-command-context.js';
import { registerSessionCommandReceipts } from './session-command-receipts.js';
import { registerSessionActivity } from './session-activity.js';
import { registerContextItems } from './context-items.js';
import {
  registerProposals,
  canReadProposalCreateReceipt,
  canReadProposalReviewReceipt,
} from './proposals.js';
import { recordContextIndex } from './context-index.js';
import { registerContextIndexLifecycle } from './context-index-lifecycle.js';
import { PostgresObservedState } from './observed-state.js';
import { registerObservedDirectory } from './observed-directory.js';
import { recallProjectMemory } from './memory-recall.js';

export interface PlatformServerOptions {
  host?: string;
  port?: number;
  version?: string;
  vector_enabled?: boolean;
  rate_limit?: number;
  plane_webhook_secret?: string;
  /** Opt-in database-wide counts on the operational /metrics endpoint. */
  plane_inbox_metrics_enabled?: boolean;
  opa_url?: string;
  policy_fetch?: typeof fetch;
  on_audit?: (record: AuditRecord) => void;
  audit_persist?: (record: AuditRecord) => Promise<void>;
  workbench_db?: WorkbenchDatabase;
  /** Trusted reader that enforces current project/artifact visibility; mutually exclusive with artifact_storage. */
  artifact_reader?: ArtifactMetadataReader;
  /** Trusted version directory reader; validates current visibility and complete historical snapshots. */
  artifact_versions?: ArtifactVersionReader;
  /** Trusted current-file directory reader with scoped, permission-bound continuation. */
  artifact_registry?: ArtifactRegistryReader;
  /** Trusted original-request reader; enforces identity, current visibility and saved snapshot integrity. */
  artifact_receipts?: ArtifactReceiptReader;
  /** Trusted writer with immutable object verification and durable original-request receipts. */
  artifact_writer?: ArtifactWriter;
  /** Per-file HTTP limit; defaults to artifact_storage.max_bytes or 64 MiB. */
  artifact_upload_max_bytes?: number;
  /** Trusted content reader; requires durable audit_persist or DATABASE_URL for downloads. */
  artifact_content?: ArtifactContentReader;
  artifact_download_max_bytes?: number;
  /** Explicit server-owned S3 configuration; requires DATABASE_URL. Construction performs no storage I/O. */
  artifact_storage?: S3ArtifactOptions;
  oidc_verify?: VerifyGatewayToken;
  oidc_issuer?: string;
  oidc_audience?: string;
  oidc_fetch?: typeof fetch;
  session_current_configuration?: SessionCurrentConfiguration;
  /** Independent current-object authority in addition to the HTTP OIDC identity boundary. */
  session_current_authority?: SessionCurrentAuthority;
  /** Explicit production current-authority source; mutually exclusive with an injected authority. */
  session_current_opa?: SessionCurrentOpaOptions;
  /** Explicit factory-owned current origin approval. Enables the preserved-old-proof DB bridge;
   * no automatic selection, migration, write compatibility or fallback on bridge failure. */
  session_current_origin_authority?: SessionOriginAuthority;
  /** Optional long-term memory projection. Omit it to keep the offline context-only mode. */
  memory_service?: MemoryServiceAdapter;
  memory_provider_mode?: MemoryProviderMode;
  memory_enabled?: boolean;
  memory_required?: boolean;
  ai_memory_server_url?: string;
  ai_memory_token?: string;
  memory_actor_id?: string;
  memory_client_id?: string;
}

export interface PlatformServer {
  start(): Promise<string>;
  stop(): Promise<void>;
  auditRecords(): AuditRecord[];
}

interface RuntimeBody {
  [key: string]: unknown;
}

interface RuntimeState {
  session_current_identity: SessionCurrentIdentityScope | undefined;
  artifact_uploads: ArtifactUploadGate;
  artifact_downloads: ArtifactDownloadGate;
  observe_artifact_download: ArtifactDownloadObserver | undefined;
  artifact_writes_enabled: boolean;
  oidc_verify: VerifyGatewayToken | undefined;
  host: string;
  port: number;
  version: string;
  search: SearchService;
  resources: Map<string, RuntimeResource>;
  projection: PlaneProjection;
  plane_webhook_secret: string | undefined;
  audit: AuditService;
  plane_inbox: PostgresPlaneInbox | undefined;
  plane_inbox_metrics: PostgresPlaneInboxMetrics | undefined;
  persist_audit?: ((record: AuditRecord) => Promise<void>) | undefined;
  memory_service?: MemoryServiceAdapter;
  memory_required: boolean;
  sessions: SessionService;
  continuation: ContinuationService;
}

const DEFAULT_VERSION = '0.1.0';
const MAX_BODY_BYTES = 1024 * 1024;

export function createPlatformServer(options: PlatformServerOptions = {}): PlatformServer {
  if (
    (options.artifact_reader !== undefined ||
      options.artifact_versions !== undefined ||
      options.artifact_registry !== undefined ||
      options.artifact_receipts !== undefined ||
      options.artifact_writer !== undefined ||
      options.artifact_content !== undefined) &&
    options.artifact_storage !== undefined
  )
    throw new TypeError('Configure artifact adapters or artifact storage, not both');
  if (
    options.artifact_writer !== undefined &&
    (typeof options.artifact_writer?.createArtifact !== 'function' ||
      typeof options.artifact_writer?.putVersion !== 'function')
  )
    throw new TypeError('Invalid artifact writer');
  const artifactUploads = new ArtifactUploadGate(
    options.artifact_upload_max_bytes ?? options.artifact_storage?.max_bytes,
  );
  const artifactDownloads = new ArtifactDownloadGate(
    options.artifact_download_max_bytes ?? options.artifact_storage?.max_bytes,
  );
  if (
    options.artifact_content !== undefined &&
    (typeof options.artifact_content?.getArtifact !== 'function' ||
      typeof options.artifact_content?.getVersion !== 'function' ||
      typeof options.artifact_content?.readVersion !== 'function')
  )
    throw new TypeError('Invalid artifact content reader');
  if (
    options.artifact_reader !== undefined &&
    (typeof options.artifact_reader?.getArtifact !== 'function' ||
      typeof options.artifact_reader?.getVersion !== 'function')
  )
    throw new TypeError('Invalid artifact metadata reader');
  if (
    options.artifact_versions !== undefined &&
    typeof options.artifact_versions?.listVersions !== 'function'
  )
    throw new TypeError('Invalid artifact version directory reader');
  if (
    options.artifact_registry !== undefined &&
    typeof options.artifact_registry?.listArtifacts !== 'function'
  )
    throw new TypeError('Invalid artifact project directory reader');
  if (
    options.artifact_receipts !== undefined &&
    typeof options.artifact_receipts?.getCommandReceipt !== 'function'
  )
    throw new TypeError('Invalid artifact receipt reader');
  if (options.artifact_storage !== undefined && !process.env.DATABASE_URL)
    throw new TypeError('Artifact storage requires DATABASE_URL');
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? Number(process.env.PORT ?? 3000);
  const version = options.version ?? process.env.APP_VERSION ?? DEFAULT_VERSION;
  const search = new SearchService({
    vector_enabled: options.vector_enabled ?? process.env.VECTOR_ENABLED === 'true',
  });
  const memoryMode = resolveMemoryMode(
    options.memory_provider_mode ?? process.env.MEMORY_PROVIDER_MODE,
  );
  const memory =
    options.memory_service ??
    (memoryMode ? createConfiguredMemory(options, memoryMode) : undefined);
  const memoryRequired = options.memory_required ?? process.env.MEMORY_REQUIRED === 'true';
  const resources = new Map<string, RuntimeResource>();
  const projection = new PlaneProjection();
  const planeMetricsEnabled =
    options.plane_inbox_metrics_enabled ?? process.env.PLANE_INBOX_METRICS_ENABLED === 'true';
  if (planeMetricsEnabled && !process.env.DATABASE_URL)
    throw new Error('Plane inbox metrics require DATABASE_URL');
  const auditDb = process.env.DATABASE_URL
    ? postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 })
    : undefined;
  const planeInbox = auditDb ? new PostgresPlaneInbox(auditDb) : undefined;
  // A slow aggregate scan must not monopolize the worker and audit connection.
  const planeMetricsDb = planeMetricsEnabled
    ? postgres(process.env.DATABASE_URL!, { max: 1, connect_timeout: 5 })
    : undefined;
  const planeMetrics = planeMetricsDb ? new PostgresPlaneInboxMetrics(planeMetricsDb) : undefined;
  const sessionStore = auditDb ? new PostgresSessionStore(auditDb) : undefined;
  const artifactService =
    options.artifact_storage !== undefined && auditDb
      ? createS3PersistentArtifactService(auditDb, options.artifact_storage)
      : undefined;
  const artifactReader = options.artifact_reader ?? options.artifact_content ?? artifactService;
  const artifactReceipts = options.artifact_receipts ?? artifactService;
  const artifactWriter = options.artifact_writer ?? artifactService;
  const artifactContent = options.artifact_content ?? artifactService;
  const workbenchDb: WorkbenchDatabase | undefined =
    options.workbench_db ??
    (auditDb
      ? {
          query: <T>(text: string, params: unknown[] = []) =>
            auditDb.unsafe<T[]>(text, params as (string | number | boolean | null | Date)[]),
        }
      : undefined);
  const workbench = new WorkbenchRepository(workbenchDb);
  const projectSearch = new PostgresProjectSearch(workbenchDb);
  const legacySearch = new PostgresLegacySearch(workbenchDb);
  const observed = new PostgresObservedState(workbenchDb);
  const issuer = options.oidc_issuer ?? process.env.AUTH_SERVER_ISSUER;
  const verifier =
    issuer && !options.oidc_verify
      ? new OidcTokenVerifier({
          issuer,
          audience: options.oidc_audience ?? process.env.AUTH_SERVER_AUDIENCE ?? 'Base',
          fetch_impl: options.oidc_fetch,
        })
      : undefined;
  const verifyGatewayToken = options.oidc_verify ?? verifier?.verifyAuthorization.bind(verifier);
  if (options.session_current_opa &&
      (!options.session_current_configuration || !verifyGatewayToken || options.session_current_authority))
    throw new Error('Current session OPA requires configuration, OIDC and no alternate authority');
  if (options.session_current_origin_authority && (!auditDb || !options.session_current_configuration ||
      !options.session_current_opa || !verifyGatewayToken))
    throw new Error('Current session origin bridge requires database, OIDC, current OPA and explicit configuration');
  const sessionCurrentIdentity = options.session_current_opa && verifyGatewayToken
    ? new SessionCurrentIdentityScope(verifyGatewayToken, options.session_current_opa)
    : undefined;
  const sessions = new SessionService(sessionStore);
  const continuation = new ContinuationService(sessions, sessionStore);
  const policy = new PolicyService({
    opa_url: options.opa_url ?? process.env.OPA_URL,
    fetch_impl: options.policy_fetch ?? fetch,
  });
  const audit = new AuditService();
  const persistAudit =
    options.audit_persist ??
    (auditDb
      ? async (record: AuditRecord) => {
          await auditDb`
            INSERT INTO wcp_audit_records
              (audit_id, tenant_id, workspace_id, project_id, actor_id, client_id, session_id, action, resource,
               result, classification, details, trace_id, source_refs, occurred_at)
            VALUES
              (${record.audit_id}, ${record.tenant_id}, ${record.workspace_id}, ${record.project_id},
               ${record.actor_id}, ${record.client_id}, ${record.session_id ?? null}, ${record.action}, ${record.resource},
               ${record.result}, ${record.classification}, ${JSON.stringify(record.details)}::jsonb,
               ${record.trace_id}, ${JSON.stringify(record.source_refs)}::jsonb, ${record.occurred_at})
            ON CONFLICT (audit_id) DO UPDATE SET
              details = EXCLUDED.details,
              trace_id = EXCLUDED.trace_id
          `;
        }
      : undefined);
  let auditSequence = 0;
  const auditArtifactDownload: ArtifactDownloadAudit | undefined = persistAudit
    ? async (context, artifact, phase) => {
        const record = audit.recordAudit({
          tenant_id: context.tenant_id as Ulid,
          workspace_id: context.workspace_id as Ulid,
          project_id: context.project_id as Ulid,
          actor_id: context.actor_id,
          client_id: context.client_id,
          action: 'artifact.download.' + phase,
          resource: `artifact:${artifact.artifact_id}:version:${artifact.version}`,
          result: phase === 'release' ? 'allowed' : 'denied',
          classification: artifact.classification,
          trace_id: context.trace_id,
          source_refs: [{ type: 'artifact', id: artifact.artifact_id, revision: artifact.version }],
          details: { version: artifact.version, size: artifact.size, delivery_confirmed: false },
          idempotency_key: 'artifact-download-' + phase + '-' + createUlid(),
        });
        const id = record.audit_id;
        await persistAudit(structuredClone(record));
        options.on_audit?.(structuredClone(record));
        return id;
      }
    : undefined;
  const auditExport: AuditExportAudit | undefined = persistAudit
    ? async (context, target, phase, bytes, sha256) => {
        const record = audit.recordAudit({
          tenant_id: context.tenant_id as Ulid,
          workspace_id: context.workspace_id as Ulid,
          project_id: context.project_id as Ulid,
          actor_id: context.actor_id,
          client_id: context.client_id,
          action: 'audit.export.' + phase,
          resource: 'audit:' + target.audit_id,
          result: phase === 'release' ? 'allowed' : 'denied',
          classification: target.classification,
          trace_id: context.trace_id,
          source_refs: [{ type: 'audit', id: target.audit_id }],
          details: {
            row_count: 1,
            bounded_view: true,
            document_bytes: bytes,
            // Existing classification redaction also applies to this digest string.
            ...(sha256 === undefined ? {} : { document_sha256: sha256 }),
            details_omitted: target.details_state === 'too-large',
            sources_omitted: target.source_refs_state === 'too-large',
            delivery_confirmed: false,
          },
          idempotency_key: 'audit-export-' + phase + '-' + createUlid(),
        });
        await persistAudit(structuredClone(record));
        try {
          options.on_audit?.(structuredClone(record));
        } catch {
          /* Persistence is already confirmed. */
        }
        return record.audit_id;
      }
    : undefined;
  const observeArtifactDownload = persistAudit
    ? boundedArtifactDownloadObserver(async (context, query, event) => {
        const phase =
          event.kind === 'failure'
            ? 'failure.' + event.stage
            : 'transport.' + event.transport + '.' + event.outcome;
        const record = audit.recordAudit({
          tenant_id: context.tenant_id as Ulid,
          workspace_id: context.workspace_id as Ulid,
          project_id: context.project_id as Ulid,
          actor_id: context.actor_id,
          client_id: context.client_id,
          action: 'artifact.download.' + phase,
          // This is a caller-supplied target, not evidence that the artifact exists.
          resource: `artifact:${query.artifact_id}:version:${query.version}`,
          result: event.kind === 'transport' && event.outcome === 'finished' ? 'allowed' : 'error',
          classification: 'restricted',
          trace_id: context.trace_id,
          source_refs: event.release_audit_id
            ? [{ type: 'audit', id: event.release_audit_id }]
            : [],
          details: {
            version: query.version,
            requested_size: query.size,
            requested_target: true,
            release_audit_confirmed: event.release_audit_id !== undefined,
            delivery_confirmed: false,
          },
          idempotency_key: 'artifact-download-observation-' + createUlid(),
        });
        await persistAudit(structuredClone(record));
        options.on_audit?.(structuredClone(record));
      })
    : undefined;
  const router = new CommandRouter(
    async (request) => {
      if (request.operation === sessionCurrentOperation &&
          (request.context.authenticated_client !== true ||
           !Number.isFinite(Date.parse(request.context.token_expires_at ?? '')) ||
           Date.parse(request.context.token_expires_at!) <= Date.now() ||
           !request.context.capability.includes('context.read')))
        return { allowed: false as const, reason: 'current_session_read_context_required' };
      const authContext = {
        tenant_id: request.context.tenant_id,
        workspace_id: request.context.workspace_id,
        project_id: request.context.project_id,
        actor_id: request.context.actor_id,
        client_id: request.context.client_id,
        roles: request.context.roles ?? [],
        capabilities: request.context.capability,
        ...(request.context.actor_type ? { actor_type: request.context.actor_type } : {}),
        token_expires_at:
          request.context.token_expires_at ?? new Date(Date.now() + 5 * 60_000).toISOString(),
        trace_id: request.context.trace_id,
      };
      if (request.operation.startsWith('artifact.')) {
        const required = [
          'artifact.receipt',
          'artifact.create',
          'artifact.put-version',
          'artifact.upload-context',
        ].includes(request.operation)
          ? 'artifact.write'
          : 'artifact.read';
        if (!authContext.capabilities.includes(required))
          return { allowed: false, reason: `missing_capability:${required}` };
      }
      if (
        ['conflict.receipt', 'conflict.command-context'].includes(request.operation) &&
        !canReadConflictReceipt(request.context)
      )
        return { allowed: false, reason: 'verified_conflict_resolver_required' };
      if (
        request.operation === 'proposal.create.receipt' &&
        !canReadProposalCreateReceipt(request.context)
      )
        return { allowed: false, reason: 'verified_proposal_writer_required' };
      if (
        request.operation === 'proposal.review.receipt' &&
        !canReadProposalReviewReceipt(request.context)
      )
        return { allowed: false, reason: 'verified_human_proposal_reviewer_required' };
      if (
        ['sync.command-context', 'sync.event.receipt'].includes(request.operation) &&
        !canReadSyncCommandContext(request.context)
      )
        return { allowed: false, reason: 'verified_sync_writer_required' };
      if (
        ['sync.cursor', 'sync.ack'].includes(request.operation) &&
        !canReadSyncStream(request.context)
      )
        return { allowed: false, reason: 'verified_sync_reader_required' };
      if (
        request.operation === 'session.command-context' &&
        !canReadSessionCommandContext(request.context)
      )
        return { allowed: false, reason: 'verified_session_command_context_required' };
      if (
        request.operation === 'context.pack.save-context' &&
        !canReadContextPackSaveContext(request.context)
      )
        return { allowed: false, reason: 'verified_context_pack_reader_required' };
      if (
        request.operation === 'context.pack.save-receipt' &&
        !canReadContextPackSaveReceipt(request.context)
      )
        return { allowed: false, reason: 'verified_original_context_pack_reader_required' };
      if (
        request.operation === 'workbench.query' &&
        request.input.operation === 'admin' &&
        (!authContext.roles.includes('admin') ||
          request.context.authenticated_client !== true ||
          !authContext.capabilities.includes('admin.read') ||
          !Number.isFinite(Date.parse(request.context.token_expires_at ?? '')) ||
          Date.parse(request.context.token_expires_at!) <= Date.now())
      )
        return { allowed: false, reason: 'verified_admin_read_required' };
      if (
        request.operation.startsWith('plane.inbox.') &&
        (!authContext.roles.includes('admin') || request.context.authenticated_client !== true)
      )
        return { allowed: false, reason: 'authenticated_admin_required' };
      if (
        [
          'proposal.confirm',
          'proposal.reject',
          'context.item.confirm',
          'plane.inbox.retry',
        ].includes(request.operation) &&
        (request.context.actor_type !== 'human' || request.context.authenticated_client !== true)
      )
        return { allowed: false, reason: 'human_reviewer_required' };
      const decision = await policy.authorizeWithOpa({
        action: policyAction(request),
        resource: {
          tenant_id: request.context.tenant_id,
          workspace_id: request.context.workspace_id,
          project_id: request.context.project_id,
        },
        context: authContext,
      });
      return toRouterDecision(decision);
    },
    async (request, decision) => {
      const originalArtifactCommand =
        request.operation.startsWith('artifact.') &&
        (request.input.command ??
          (request.input.request as Record<string, unknown> | undefined)?.command);
      const artifactCommand =
        originalArtifactCommand &&
        typeof originalArtifactCommand === 'object' &&
        !Array.isArray(originalArtifactCommand)
          ? (originalArtifactCommand as Record<string, unknown>)
          : undefined;
      const artifactAuditId =
        artifactCommand?.operation === 'artifact.put-version'
          ? artifactCommand.artifact_id
          : request.input.artifact_id;
      const conflictCommand = request.input.command;
      const requestedConflictId =
        request.operation === 'conflict.receipt' &&
        conflictCommand &&
        typeof conflictCommand === 'object' &&
        !Array.isArray(conflictCommand)
          ? (conflictCommand as Record<string, unknown>).conflict_id
          : request.input.conflict_id;
      const conflictAuditId =
        isSyncIdentifier(requestedConflictId) &&
        requestedConflictId !== '.' &&
        requestedConflictId !== '..'
          ? requestedConflictId
          : undefined;
      const refs = request.operation.startsWith('session.')
        ? ['session', 'checkpoint', 'handoff'].flatMap((type) => {
            const id = request.input[type + '_id'];
            return typeof id === 'string' ? [{ type, id }] : [];
          })
        : ['conflict.resolve', 'conflict.read', 'conflict.receipt'].includes(request.operation) &&
            typeof conflictAuditId === 'string'
          ? [{ type: 'conflict', id: conflictAuditId }]
          : request.operation.startsWith('context.item.') &&
              typeof request.input.item_id === 'string'
            ? [{ type: 'context-item', id: request.input.item_id }]
            : request.operation.startsWith('proposal.') &&
                typeof request.input.proposal_id === 'string'
              ? [{ type: 'proposal', id: request.input.proposal_id }]
              : request.operation.startsWith('artifact.') && isUlid(artifactAuditId)
                ? [{ type: 'artifact', id: artifactAuditId }]
                : [];
      const sessionTarget = requestedAuditSession(request);
      const record = audit.recordAudit({
        tenant_id: request.context.tenant_id as never,
        workspace_id: request.context.workspace_id as never,
        project_id: request.context.project_id as never,
        actor_id: request.context.actor_id,
        client_id: request.context.client_id,
        ...(sessionTarget === undefined ? {} : { session_id: sessionTarget }),
        action: request.operation,
        resource:
          request.operation === 'workbench.query' && typeof request.input.operation === 'string'
            ? `workbench:${request.input.operation.slice(0, 64)}`
            : ['conflict.resolve', 'conflict.read', 'conflict.receipt'].includes(
                  request.operation,
                ) && conflictAuditId !== undefined
              ? `conflict:${conflictAuditId}`
              : `runtime:${request.operation}`,
        result: decision.allowed ? 'allowed' : 'denied',
        classification: 'internal',
        details: decision.allowed ? {} : { reason: decision.reason },
        trace_id: request.context.trace_id,
        source_refs: refs,
        idempotency_key: `runtime-audit-${request.context.trace_id}-${auditSequence++}`,
      });
      options.on_audit?.(record);
      if (persistAudit) {
        try {
          await persistAudit(record);
        } catch {
          throw new ContractError(
            'AUDIT_PERSISTENCE_UNAVAILABLE',
            'Audit persistence is unavailable',
            {
              trace_id: record.trace_id,
              retryable: true,
              source: 'audit-sink',
            },
          );
        }
      }
    },
  );
  router.register('project.state', async (request) => {
    if (Object.keys(request.input).some((key) => key !== 'project_id'))
      throw new ContractError('INVALID_INPUT', 'Only project_id is accepted', {
        trace_id: request.context.trace_id,
      });
    const state = await observed.read('Project', request.input.project_id, request.context);
    return {
      schema_version: 1,
      trace_id: request.context.trace_id,
      source_refs: state.source_refs,
      data: state,
    };
  });
  router.register('workitem.state', async (request) => {
    if (Object.keys(request.input).some((key) => key !== 'work_item_id'))
      throw new ContractError('INVALID_INPUT', 'Only work_item_id is accepted', {
        trace_id: request.context.trace_id,
      });
    const state = await observed.read('WorkItem', request.input.work_item_id, request.context);
    return {
      schema_version: 1,
      trace_id: request.context.trace_id,
      source_refs: state.source_refs,
      data: state,
    };
  });
  router.register('workitem.context', async (request) => {
    if (Object.keys(request.input).some((key) => key !== 'work_item_id'))
      throw new ContractError('INVALID_INPUT', 'Only work_item_id is accepted', {
        trace_id: request.context.trace_id,
      });
    const state = await observed.read('WorkItem', request.input.work_item_id, request.context);
    if (state.schema_version === 2)
      throw new ContractError(
        'OBSERVED_RECORD_DELETED',
        'The saved Plane work item was deleted; read its state for the deletion observation',
        { trace_id: request.context.trace_id },
      );
    const title = (
      typeof state.fields.title === 'string' && state.fields.title.trim()
        ? state.fields.title
        : state.external_id
    ).slice(0, 1000);
    const stateHit: SearchHit = {
      schema_version: 1,
      tenant_id: state.tenant_id,
      workspace_id: state.workspace_id,
      project_id: state.project_id,
      id: `plane:WorkItem:${state.external_id}`,
      title,
      snippet: `${title} (${state.status ?? 'observed'})`,
      revision: state.plane_version,
      score: 1,
      rank_source: 'fts',
      classification: state.classification,
      source_refs: state.source_refs,
    };
    const recalled = await recallProjectMemory(memory, memoryRequired, request.context, title, 19);
    const hits = [stateHit, ...recalled.hits];
    const sourceRefs = uniqueSourceRefs([
      ...state.source_refs,
      ...hits.flatMap((hit) => hit.source_refs),
    ]);
    return {
      schema_version: 1,
      trace_id: request.context.trace_id,
      source_refs: sourceRefs,
      data: {
        work_item: state,
        context_pack: {
          schema_version: 1,
          query: title,
          trace_id: request.context.trace_id,
          degraded: recalled.degraded || memory === undefined,
          backend: 'postgres',
          memory_used: recalled.used,
          vector_used: false,
          hits,
          source_refs: sourceRefs,
        },
      },
    };
  });
  router.register('context.index', async (request) => {
    if (request.context.authenticated_client !== true)
      throw new ContractError('DENIED', 'Context indexing requires a verified client', {
        trace_id: request.context.trace_id,
      });
    let input;
    try {
      const { idempotency_key, ...fields } = request.input;
      validateIdempotencyKey(idempotencyFor(request));
      if (idempotency_key !== undefined && idempotency_key !== idempotencyFor(request))
        throw new Error('Request keys disagree');
      input = parseIndexedContextInput(fields);
    } catch (error) {
      throw new ContractError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Invalid context index',
        { trace_id: request.context.trace_id },
      );
    }
    if (input.id.startsWith('plane:'))
      throw new ContractError(
        'INVALID_INPUT',
        'Plane index IDs are owned by the webhook projector',
        { trace_id: request.context.trace_id },
      );
    if (
      input.classification === 'restricted' &&
      !request.context.capability.includes('data.restricted.read')
    )
      throw new ContractError(
        'DENIED',
        'Restricted context indexing requires restricted data access',
        { trace_id: request.context.trace_id },
      );
    if (!auditDb)
      throw new ContractError(
        'CONTEXT_PERSISTENCE_UNAVAILABLE',
        'Context index storage is not configured',
        { trace_id: request.context.trace_id, retryable: true },
      );
    let hit: SearchHit;
    try {
      hit = await recordContextIndex(
        auditDb,
        request.context,
        idempotencyFor(request),
        input,
        async () => {
          if (!memory) {
            if (memoryRequired)
              throw new ContractError(
                'MEMORY_PROVIDER_OFF',
                'Required memory provider is not configured',
                { trace_id: request.context.trace_id },
              );
            return [];
          }
          if (input.source_refs.length >= 64)
            throw new ContractError(
              'INVALID_INPUT',
              'Leave one source reference slot for external memory',
              { trace_id: request.context.trace_id },
            );
          try {
            const ref = await memory.capture({
              ...toMemoryScope(request.context),
              content: `${input.title}\n\n${input.snippet}`,
              trace_id: request.context.trace_id,
            });
            if (
              ref.tenant_id !== request.context.tenant_id ||
              ref.workspace_id !== request.context.workspace_id ||
              ref.project_id !== request.context.project_id ||
              typeof ref.page_ref !== 'string' ||
              !ref.page_ref
            )
              throw new ContractError(
                'MEMORY_SCOPE_MISMATCH',
                'Memory capture returned another scope',
                { trace_id: request.context.trace_id },
              );
            return [{ type: 'ai-memory', id: ref.page_ref }];
          } catch (error) {
            if (memoryRequired) throw error;
            return [];
          }
        },
      );
    } catch (error) {
      if (error instanceof ContractError) throw error;
      throw new ContractError(
        'CONTEXT_PERSISTENCE_UNAVAILABLE',
        'Context index could not be saved',
        { trace_id: request.context.trace_id, retryable: true },
      );
    }
    return {
      schema_version: 1,
      trace_id: request.context.trace_id,
      source_refs: hit.source_refs,
      data: hit,
    };
  });
  router.register('project.search', async (request) => {
    let query;
    try {
      query = parseProjectSearchQuery(request.input);
    } catch (error) {
      throw new ContractError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Invalid search query',
        { trace_id: request.context.trace_id },
      );
    }
    const { tenant_id, workspace_id, project_id, trace_id } = request.context;
    const data = await projectSearch.search(
      {
        tenant_id,
        workspace_id,
        project_id,
        read_restricted: request.context.capability.includes('data.restricted.read'),
      },
      query,
      trace_id,
    );
    return {
      schema_version: 1,
      trace_id,
      data,
      source_refs: [
        ...(query.type === 'context_item' ? [] : [{ type: 'postgres', id: 'wcp_work_items' }]),
        ...(query.type === 'work_item' ? [] : [{ type: 'postgres', id: 'wcp_context_items' }]),
      ],
    };
  });
  router.register('context.search', async (request) => {
    let query;
    try {
      query = parseLegacySearchQuery(request.input);
    } catch (error) {
      throw new ContractError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Invalid search query',
        { trace_id: request.context.trace_id },
      );
    }
    const result = await legacySearch.search(
      {
        tenant_id: request.context.tenant_id,
        workspace_id: request.context.workspace_id,
        project_id: request.context.project_id,
        read_restricted: request.context.capability.includes('data.restricted.read'),
      },
      query,
      request.context.trace_id,
    );
    if (
      memory &&
      request.context.capability.includes('data.restricted.read') &&
      !(await legacySearch.projectReadable(
        { ...request.context, read_restricted: true },
        request.context.trace_id,
      ))
    )
      throw new ContractError('DENIED', 'Project memory is not readable', {
        trace_id: request.context.trace_id,
      });
    const recalled = await recallProjectMemory(
      memory,
      memoryRequired,
      request.context,
      query.query,
      query.budget,
    );
    const hits = [...result.hits, ...recalled.hits].slice(0, query.budget);
    const source_refs = hits.flatMap((hit) => hit.source_refs);
    return {
      schema_version: 1,
      trace_id: request.context.trace_id,
      source_refs,
      data: {
        ...result,
        hits,
        source_refs,
        memory_used: recalled.used,
        degraded: result.degraded || recalled.degraded,
      },
    };
  });
  router.register('context.handoff.create', async (request) => {
    if (!memory)
      throw new ContractError('MEMORY_PROVIDER_OFF', 'Memory provider is not configured', {
        trace_id: request.context.trace_id,
        retryable: true,
      });
    const handoff = await memory.create_handoff(
      requireString(request.input.page_ref, 'page_ref'),
      toMemoryScope(request.context),
      request.context.trace_id,
    );
    return {
      schema_version: 1,
      trace_id: request.context.trace_id,
      source_refs: [{ type: 'ai-memory', id: handoff.page_ref }],
      data: handoff,
    };
  });
  router.register('context.handoff.claim', async (request) => {
    if (!memory)
      throw new ContractError('MEMORY_PROVIDER_OFF', 'Memory provider is not configured', {
        trace_id: request.context.trace_id,
        retryable: true,
      });
    const result = await memory.claim_handoff(
      requireString(request.input.handoff_ref, 'handoff_ref'),
      request.input.claim_client_id === undefined
        ? request.input.client_id === undefined
          ? request.context.client_id
          : requireString(request.input.client_id, 'client_id')
        : requireString(request.input.claim_client_id, 'claim_client_id'),
    );
    return {
      schema_version: 1,
      trace_id: request.context.trace_id,
      source_refs: [{ type: 'ai-memory', id: result.page_ref }],
      data: result,
    };
  });

  router.register('session.start', async (request) => {
    if (request.context.authenticated_client !== true)
      throw new ContractError('DENIED', 'A verified client is required for session start', {
        trace_id: request.context.trace_id,
      });
    let command;
    let key: string;
    try {
      const { idempotency_key, ...fields } = request.input;
      key = validateIdempotencyKey(idempotencyFor(request));
      if (
        (idempotency_key !== undefined && idempotency_key !== key) ||
        request.context.expected_version !== undefined
      )
        throw new TypeError('Start keys disagree or an unrelated version was supplied');
      command = parseSessionStartCommand(fields);
      assertSessionStartIdentity(command, request.context);
    } catch (error) {
      throw new ContractError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Invalid session start',
        { trace_id: request.context.trace_id },
      );
    }
    const result = await sessions.startSessionWithReceiptAsync({
      ...projectScope(request),
      client_id: request.context.client_id,
      actor_id: request.context.actor_id,
      ...(command.parent_session_id === undefined
        ? {}
        : { parent_session_id: command.parent_session_id as Ulid }),
      trace_id: request.context.trace_id,
      idempotency_key: key,
      receipt: commandReceipt(request, key),
      read_restricted: request.context.capability.includes('data.restricted.read'),
    });
    return commandResult(
      request,
      { ...result.session, start_receipt: result.receipt },
      result.session.source_refs,
    );
  });
  router.register('session.run.start', async (request) => {
    const model = optionalString(request.input.model);
    const run = await sessions.appendAgentRunAsync({
      ...projectScope(request),
      read_restricted: request.context.capability.includes('data.restricted.read'),
      session_id: requireString(request.input.session_id, 'session_id') as never,
      ...(model === undefined ? {} : { model }),
      trace_id: request.context.trace_id,
      expected_version: expectedVersion(request),
      receipt: sessionMutationReceipt(request),
    });
    return commandResult(request, run, run.source_refs);
  });
  router.register('session.run.finish', async (request) => {
    const run = await sessions.finishAgentRunAsync({
      ...projectScope(request),
      read_restricted: request.context.capability.includes('data.restricted.read'),
      session_id: requireString(request.input.session_id, 'session_id') as never,
      run_id: requireString(request.input.run_id, 'run_id') as never,
      status: requireEnum(request.input.status, 'status', ['completed', 'failed']),
      expected_run_version: requireInteger(
        request.input.expected_run_version,
        'expected_run_version',
      ),
      expected_version: expectedVersion(request),
      trace_id: request.context.trace_id,
      receipt: sessionMutationReceipt(request),
    });
    return commandResult(request, run, run.source_refs);
  });
  router.register('session.tool.call', async (request) => {
    const toolCall = await sessions.recordToolCallAsync({
      ...projectScope(request),
      read_restricted: request.context.capability.includes('data.restricted.read'),
      session_id: requireString(request.input.session_id, 'session_id') as never,
      run_id: requireString(request.input.run_id, 'run_id') as never,
      tool_name: requireString(request.input.tool_name, 'tool_name'),
      status: requireEnum(request.input.status, 'status', ['started', 'succeeded', 'failed']),
      trace_id: request.context.trace_id,
      expected_version: expectedVersion(request),
      receipt: sessionMutationReceipt(request),
    });
    return commandResult(request, toolCall, toolCall.source_refs);
  });
  router.register('session.tool.finish', async (request) => {
    const toolCall = await sessions.finishToolCallAsync({
      ...projectScope(request),
      read_restricted: request.context.capability.includes('data.restricted.read'),
      session_id: requireString(request.input.session_id, 'session_id') as never,
      tool_call_id: requireString(request.input.tool_call_id, 'tool_call_id') as never,
      status: requireEnum(request.input.status, 'status', ['succeeded', 'failed']),
      expected_tool_version: requireInteger(
        request.input.expected_tool_version,
        'expected_tool_version',
      ),
      expected_version: expectedVersion(request),
      trace_id: request.context.trace_id,
      receipt: sessionMutationReceipt(request),
    });
    return commandResult(request, toolCall, toolCall.source_refs);
  });
  router.register('session.end', async (request) => {
    const session = await sessions.endSessionAsync({
      ...projectScope(request),
      read_restricted: request.context.capability.includes('data.restricted.read'),
      session_id: requireString(request.input.session_id, 'session_id') as never,
      status: requireEnum(request.input.status, 'status', ['ended', 'abandoned', 'failed']),
      trace_id: request.context.trace_id,
      expected_version: expectedVersion(request),
      receipt: sessionMutationReceipt(request),
    });
    return commandResult(request, session, session.source_refs);
  });
  router.register('session.checkpoint', async (request) => {
    assertSessionWriter(request);
    if (request.input.context_pack_id !== undefined && request.input.context_pack !== undefined)
      throw new ContractError(
        'INVALID_INPUT',
        'Supply context_pack_id or a legacy context_pack, not both',
        {
          trace_id: request.context.trace_id,
        },
      );
    const hasKey =
      request.context.idempotency_key !== undefined || request.input.idempotency_key !== undefined;
    if (request.input.context_pack_id !== undefined && !hasKey)
      throw new ContractError(
        'INVALID_INPUT',
        'A saved pack binding requires a stable idempotency key',
        {
          trace_id: request.context.trace_id,
        },
      );
    const input = {
      ...projectScope(request),
      session_id: requireString(request.input.session_id, 'session_id') as never,
      completed: requireStringArray(request.input.completed, 'completed'),
      in_progress: requireStringArray(request.input.in_progress, 'in_progress'),
      next_actions: requireStringArray(request.input.next_actions, 'next_actions'),
      decisions: requireStringArray(request.input.decisions, 'decisions'),
      risks: requireStringArray(request.input.risks, 'risks'),
      open_questions: requireStringArray(request.input.open_questions, 'open_questions'),
      ...(request.input.context_pack === undefined
        ? {}
        : { context_pack: request.input.context_pack as never }),
      ...(request.input.memory_ref === undefined
        ? {}
        : { memory_ref: request.input.memory_ref as never }),
      trace_id: request.context.trace_id,
      expected_session_version: expectedVersion(request),
      read_restricted: request.context.capability.includes('data.restricted.read'),
      ...(hasKey ? { receipt: commandReceipt(request, idempotencyFor(request)) } : {}),
    };
    const record = async (document?: ContextPackReceipt, writer = continuation) => {
      const checkpoint = await writer.createCheckpointAsync({
        ...input,
        ...(document === undefined
          ? {}
          : {
              context_pack_id: document.pack_id,
              context_pack: document.pack,
            }),
      });
      return commandResult(request, checkpoint, checkpoint.source_refs);
    };
    return request.input.context_pack_id === undefined
      ? record()
      : withSavedContextPack(
          router,
          auditDb,
          request.context,
          request.input.context_pack_id,
          (document, tx) => {
            const store = new PostgresSessionStore(tx, true);
            return record(document, new ContinuationService(new SessionService(store), store));
          },
        );
  });
  router.register('session.handoff', async (request) => {
    if (request.context.authenticated_client !== true)
      throw new ContractError('DENIED', 'A verified client is required for handoff creation', {
        trace_id: request.context.trace_id,
      });
    let command;
    let key: string;
    try {
      const { idempotency_key, ...fields } = request.input;
      key = validateIdempotencyKey(idempotencyFor(request));
      if (
        (idempotency_key !== undefined && idempotency_key !== key) ||
        request.context.expected_version !== undefined
      )
        throw new TypeError('Creation keys disagree or an unrelated version was supplied');
      command = parseHandoffCreateCommand(fields);
      if (
        !isUlid(command.session_id) ||
        (command.from_client !== undefined && command.from_client !== request.context.client_id)
      )
        throw new TypeError('Creation requires the original session and verified sender');
    } catch (error) {
      throw new ContractError(
        'INVALID_INPUT',
        error instanceof Error ? error.message : 'Invalid handoff creation',
        { trace_id: request.context.trace_id },
      );
    }
    const result = await continuation.createHandoffWithReceiptAsync({
      ...projectScope(request),
      session_id: command.session_id as Ulid,
      checkpoint_id: command.checkpoint_id as Ulid,
      from_client: request.context.client_id,
      actor_id: request.context.actor_id,
      ...(command.target_client === undefined ? {} : { target_client: command.target_client }),
      trace_id: request.context.trace_id,
      idempotency_key: key,
      receipt: commandReceipt(request, key),
      read_restricted: request.context.capability.includes('data.restricted.read'),
    });
    return commandResult(
      request,
      { ...result.handoff, create_receipt: result.receipt },
      result.handoff.source_refs,
    );
  });
  router.register('session.handoff.claim', async (request) => {
    const version = request.context.expected_version ?? request.input.expected_version;
    const hasKey =
      request.context.idempotency_key !== undefined || request.input.idempotency_key !== undefined;
    if (hasKey) {
      if (request.context.authenticated_client !== true)
        throw new ContractError('DENIED', 'A verified client is required for a durable claim', {
          trace_id: request.context.trace_id,
        });
      let command;
      let key: string;
      try {
        const { idempotency_key, ...fields } = request.input;
        key = validateIdempotencyKey(idempotencyFor(request));
        if (idempotency_key !== undefined && idempotency_key !== key)
          throw new TypeError('Request keys disagree');
        if (
          request.context.expected_version !== undefined &&
          fields.expected_version !== undefined &&
          fields.expected_version !== request.context.expected_version
        )
          throw new TypeError('Claim versions disagree');
        command = parseHandoffClaimCommand({ ...fields, expected_version: version });
        if (
          !isUlid(command.handoff_id) ||
          (command.client_id !== undefined && command.client_id !== request.context.client_id)
        )
          throw new TypeError('Claim must address this handoff using the verified client');
      } catch (error) {
        throw new ContractError(
          'INVALID_INPUT',
          error instanceof Error ? error.message : 'Invalid handoff claim',
          { trace_id: request.context.trace_id },
        );
      }
      const result = await continuation.claimHandoffWithReceiptAsync({
        ...projectScope(request),
        handoff_id: command.handoff_id as Ulid,
        client_id: request.context.client_id,
        actor_id: request.context.actor_id,
        expected_version: command.expected_version,
        trace_id: request.context.trace_id,
        receipt: commandReceipt(request, key),
        read_restricted: request.context.capability.includes('data.restricted.read'),
      });
      return commandResult(
        request,
        { ...result.handoff, claim_receipt: result.receipt },
        result.handoff.source_refs,
      );
    }
    assertSessionWriter(request);
    const handoff = await continuation.claimHandoffAsync({
      ...projectScope(request),
      read_restricted: request.context.capability.includes('data.restricted.read'),
      handoff_id: requireString(request.input.handoff_id, 'handoff_id') as never,
      client_id: request.context.client_id,
      actor_id: request.context.actor_id,
      ...(version === undefined
        ? {}
        : { expected_version: requireInteger(version, 'expected_version') }),
      trace_id: request.context.trace_id,
    });
    return commandResult(request, handoff, handoff.source_refs);
  });
  router.register('session.resume', async (request) => {
    assertSessionWriter(request);
    if (
      request.input.require_claimed !== undefined &&
      typeof request.input.require_claimed !== 'boolean'
    )
      throw new ContractError('INVALID_INPUT', 'require_claimed must be a boolean', {
        trace_id: request.context.trace_id,
      });
    const handoffId = requireString(request.input.handoff_id, 'handoff_id') as never;
    const input = {
      ...projectScope(request),
      session_id: requireString(request.input.session_id, 'session_id') as never,
      require_claimed:
        request.input.require_claimed === true ||
        request.context.client_id === (process.env.AUTH_SERVER_CLIENT_ID ?? 'PlaneMem_WebConsole'),
      handoff_id: handoffId,
      read_restricted: request.context.capability.includes('data.restricted.read'),
      client_id: request.context.client_id,
      actor_id: request.context.actor_id,
      trace_id: request.context.trace_id,
      idempotency_key: idempotencyFor(request),
    };
    const checkpoint = await continuation.checkpointForResumeAsync(input);
    const resume = async (document?: ContextPackReceipt, writer = continuation) => {
      if (document && document.pack.pack_hash !== checkpoint.context_pack_hash)
        throw new ContractError('CONTEXT_PACK_INVALID', 'Checkpoint pack binding is inconsistent', {
          trace_id: request.context.trace_id,
        });
      const resumed = await writer.resumeSessionAsync(input);
      return {
        ...resumed,
        context_pack_state: document
          ? 'checked'
          : checkpoint.context_pack_hash
            ? 'legacy-unverified'
            : 'none',
        ...(document === undefined ? {} : { context_pack: document }),
      };
    };
    const resumed =
      checkpoint.context_pack_id === undefined
        ? auditDb
          ? await withSessionTransaction(auditDb, request.context.trace_id, (tx) => {
              const store = new PostgresSessionStore(tx, true);
              return resume(undefined, new ContinuationService(new SessionService(store), store));
            })
          : await resume()
        : await withSavedContextPack(
            router,
            auditDb,
            request.context,
            checkpoint.context_pack_id,
            (document, tx) => {
              const store = new PostgresSessionStore(tx, true);
              return resume(document, new ContinuationService(new SessionService(store), store));
            },
          );
    sessions.cacheCommittedSession(resumed.session);
    return commandResult(request, resumed, [
      ...resumed.session.source_refs,
      ...resumed.checkpoint.source_refs,
      ...resumed.handoff.source_refs,
    ]);
  });

  router.register('sync.append', async (request) => {
    const { input, context } = request;
    if (!Array.isArray(input.events) || input.events.length < 1 || input.events.length > 100)
      throw new ContractError('INVALID_INPUT', 'Send between 1 and 100 events per batch', {
        trace_id: context.trace_id,
      });
    const key = idempotencyFor(request);
    try {
      validateIdempotencyKey(key);
    } catch {
      throw new ContractError('INVALID_INPUT', 'Invalid batch idempotency key', {
        trace_id: context.trace_id,
      });
    }
    const events = input.events;
    const result = await withSyncDatabase(auditDb, context.trace_id, (db) =>
      appendUploadBatch(db, context, events, commandReceipt(request, key)),
    );
    return {
      ...commandResult(request, { ...projectScope(request), ...result }, [
        { type: 'sync-stream', id: context.project_id },
      ]),
      server_cursor: result.next_cursor,
    };
  });
  router.register('sync.changes', async (request) => {
    const { input, context } = request;
    let query;
    try {
      query = parseSyncChangesQuery(input);
    } catch {
      throw new ContractError(
        'INVALID_INPUT',
        'Supply only a safe cursor and limit from 1 to 500',
        {
          trace_id: context.trace_id,
        },
      );
    }
    const page = await withSyncDatabase(auditDb, context.trace_id, (db) =>
      readSyncChanges(db, context, query.cursor, query.limit ?? 100),
    );
    const envelope = {
      ...commandResult(
        request,
        { ...projectScope(request), ...page },
        page.changes.flatMap((change) => change.source_refs),
      ),
      server_cursor: page.next_cursor,
    };
    try {
      return parseSyncChangesEnvelope(envelope, query, context, context.trace_id);
    } catch {
      throw new ContractError(
        'SYNC_CHANGES_INVALID',
        'The complete sync page is invalid or exceeds its limit',
        {
          trace_id: context.trace_id,
          retryable: false,
        },
      );
    }
  });
  registerSyncCursor(router, auditDb);
  registerConflictRead(router, auditDb);
  registerConflictReceipts(router, auditDb);
  registerConflictCommandContext(router);
  registerSyncCommandContext(router);
  registerSyncEventReceipt(router, auditDb);
  router.register('conflict.list', (request) => readConflictRegistry(workbench, request));
  router.register('conflict.resolve', async (request) => {
    const { input, context } = request;
    const resolution = requireEnum(input.resolution, 'resolution', [
      'local',
      'server',
      'merge',
    ] as const);
    if ((resolution === 'merge') !== Object.hasOwn(input, 'merged_value'))
      throw new ContractError('INVALID_INPUT', 'Supply merged_value only for a merge decision', {
        trace_id: context.trace_id,
      });
    if (!auditDb)
      throw new ContractError(
        'CONFLICT_STORAGE_UNAVAILABLE',
        'Conflict storage is not configured',
        { trace_id: context.trace_id, retryable: true },
      );
    const { event, server_cursor } = await persistConflictDecision(auditDb, {
      ...projectScope(request),
      conflict_id: requireString(input.conflict_id, 'conflict_id'),
      actor_id: context.actor_id,
      client_id: context.client_id,
      resolution,
      ...(resolution === 'merge' ? { merged_value: input.merged_value } : {}),
      expected_version: expectedVersion(request),
      read_restricted: context.capability.includes('data.restricted.read'),
      receipt: commandReceipt(request, idempotencyFor(request)),
      trace_id: context.trace_id,
    });
    return {
      ...commandResult(
        request,
        {
          conflict_id: event.payload.conflict_id,
          version: event.aggregate_version,
          resolution: event.payload.resolution,
          event,
        },
        event.source_refs,
      ),
      revision: event.aggregate_version,
      etag: buildEtag(event.aggregate_version),
      server_cursor,
    };
  });
  router.register('workbench.query', (request) => queryWorkbench(workbench, request, version));
  registerAuditExport(router, workbench, policy, auditExport);
  registerContextPacks(router, auditDb);
  registerContextPackSaveContext(router);
  registerContextPackDirectory(router, auditDb);
  registerContextPackSaveReceipt(router, auditDb);
  registerCheckpointReceipts(router, auditDb);
  registerCheckpointRead(router, auditDb);
  registerCheckpointHistory(router, workbench);
  registerArtifactReads(router, artifactReader);
  registerArtifactVersions(router, options.artifact_versions ?? artifactService);
  registerArtifactRegistry(router, options.artifact_registry ?? artifactService);
  registerArtifactReceipts(router, artifactReceipts);
  registerArtifactWrites(router, artifactWriter);
  registerArtifactUploadContext(router, artifactUploads.maxBytes);
  registerArtifactDownloads(
    router,
    artifactContent,
    policy,
    auditArtifactDownload,
    artifactDownloads.maxBytes,
    observeArtifactDownload,
  );
  registerHandoffRead(router, auditDb);
  registerResumeReceipts(router, auditDb);
  registerHandoffClaimReceipts(router, auditDb);
  registerHandoffCreateReceipts(router, auditDb);
  registerSessionStartReceipts(router, auditDb);
  registerSessionCommandContext(router);
  registerSessionCommandReceipts(router, auditDb);
  registerSessionActivity(router, auditDb);
  registerPlaneInboxReads(router, workbenchDb);
  registerObservedDirectory(router, workbenchDb);
  registerPlaneInboxRetries(router, auditDb);
  registerContextItems(router, auditDb);
  registerProposals(router, auditDb);
  registerContextIndexLifecycle(router, auditDb);
  registerMcpReads(router, resources, workbench, projection, legacySearch, workbenchDb);
  const api = new ApiGateway(router, options.rate_limit ?? 100);
  registerSessionCurrentRoute(router, api,
    auditDb && options.session_current_configuration
      ? new SessionCurrentReader(options.session_current_origin_authority
          ? new SessionOriginBridge(new PostgresSessionOriginStore(auditDb), options.session_current_origin_authority)
          : new PostgresSessionCurrentStore(auditDb),
          options.session_current_configuration, options.session_current_authority)
      : undefined,
    sessionCurrentIdentity ? request => sessionCurrentIdentity.forRequest(request) : undefined);
  // Internal dispatch paths are rejected by the public HTTP path router.
  api.route('POST', '/_mcp/catalog', 'mcp.catalog');
  api.route('POST', '/_mcp/resource', 'mcp.resource');
  api.route('POST', '/_mcp/prompt', 'mcp.prompt');
  api.route('POST', WORKBENCH_QUERY_PATH, 'workbench.query');
  api.route('POST', '/v1/audit/export', 'audit.export');
  api.route('POST', '/v1/context-pack/compile', 'context.pack.compile');
  api.route('GET', '/v1/context-pack/save-context', 'context.pack.save-context');
  api.route('POST', '/v1/context-pack/save-receipt', 'context.pack.save-receipt');
  api.route('GET', '/v1/context-pack', 'context.pack.read');
  api.route('GET', '/v1/context-packs', 'context.pack.list');
  api.routeTemplate('GET', '/v1/artifacts/{artifact_id}', 'artifact.read');
  api.route('GET', '/v1/artifacts/upload-context', 'artifact.upload-context');
  api.route('POST', '/v1/artifacts/receipt', 'artifact.receipt');
  api.route('POST', '/v1/artifacts', 'artifact.create');
  api.route('GET', '/v1/artifacts', 'artifact.registry.list');
  api.routeTemplate(
    'GET',
    '/v1/artifacts/{artifact_id}/versions/{version}/content',
    'artifact.download',
  );
  api.routeTemplate('POST', '/v1/artifacts/{artifact_id}/versions', 'artifact.put-version');
  api.routeTemplate('GET', '/v1/artifacts/{artifact_id}/versions', 'artifact.versions.list');
  api.routeTemplate(
    'GET',
    '/v1/artifacts/{artifact_id}/versions/{version}',
    'artifact.version.read',
  );
  api.route('POST', '/v1/context-items', 'context.item.create');
  api.route('POST', '/v1/proposals', 'proposal.create');
  api.route('POST', '/v1/proposals/creation-receipt', 'proposal.create.receipt');
  api.route('POST', '/v1/proposals/review-receipt', 'proposal.review.receipt');
  api.route('GET', '/v1/proposals', 'proposal.list');
  api.routeTemplate('GET', '/v1/proposals/{proposal_id}', 'proposal.read');
  api.routeTemplate('POST', '/v1/proposals/{proposal_id}/confirm', 'proposal.confirm');
  api.routeTemplate('POST', '/v1/proposals/{proposal_id}/reject', 'proposal.reject');
  api.routeTemplate('GET', '/v1/context-items/{item_id}', 'context.item.read');
  api.routeTemplate('GET', '/v1/context-items/{item_id}/archived', 'context.item.archived.read');
  api.routeTemplate('GET', '/v1/context-items/{item_id}/history', 'context.item.history');
  api.routeTemplate(
    'GET',
    '/v1/context-items/{item_id}/versions/{version}',
    'context.item.version.read',
  );
  api.routeTemplate('POST', '/v1/context-items/{item_id}/update', 'context.item.update');
  api.routeTemplate('POST', '/v1/context-items/{item_id}/archive', 'context.item.archive');
  api.routeTemplate('POST', '/v1/context-items/{item_id}/restore', 'context.item.restore');
  api.routeTemplate('POST', '/v1/context-items/{item_id}/confirm', 'context.item.confirm');
  api.route('GET', '/v1/conflicts', 'conflict.list');
  api.route('POST', '/v1/conflicts/receipt', 'conflict.receipt');
  api.route('GET', '/v1/conflicts/commands/context', 'conflict.command-context');
  api.routeTemplate('GET', '/v1/conflicts/{conflict_id}', 'conflict.read');
  api.route('GET', '/v1/sync/changes', 'sync.changes');
  api.route('GET', '/v1/sync/commands/context', 'sync.command-context');
  api.route('POST', '/v1/sync/events/receipt', 'sync.event.receipt');
  api.route('POST', '/v1/events:batch', 'sync.append');
  api.route('POST', '/v1/sync/ack', 'sync.ack');
  api.route('GET', '/v1/sync/cursor', 'sync.cursor');
  api.routeTemplate('POST', '/v1/conflicts/{conflict_id}/resolve', 'conflict.resolve');
  api.routeTemplate('GET', '/v1/projects/{project_id}/state', 'project.state');
  api.routeTemplate('GET', '/v1/work-items/{work_item_id}/state', 'workitem.state');
  api.route('GET', '/v1/plane/work-items', 'workitem.observed.list');
  api.routeTemplate('GET', '/v1/work-items/{work_item_id}/context', 'workitem.context');
  api.route('POST', '/v1/context/index', 'context.index');
  api.route('GET', '/v1/context/index', 'context.index.list');
  api.route('GET', '/v1/plane/events', 'plane.inbox.list');
  api.route('GET', '/v1/plane/events/summary', 'plane.inbox.summary');
  api.routeTemplate('GET', '/v1/plane/events/{event_id}', 'plane.inbox.read');
  api.routeTemplate('GET', '/v1/plane/events/{event_id}/diagnosis', 'plane.inbox.diagnosis');
  api.routeTemplate('POST', '/v1/plane/events/{event_id}/retry', 'plane.inbox.retry');
  api.routeTemplate(
    'POST',
    '/v1/plane/events/{event_id}/retry/receipt',
    'plane.inbox.retry.receipt',
  );
  api.routeTemplate('GET', '/v1/context/index/{id}', 'context.index.status');
  api.routeTemplate('POST', '/v1/context/index/{id}/delete', 'context.index.delete');
  api.routeTemplate('POST', '/v1/context/index/{id}/restore', 'context.index.restore');
  api.route('POST', '/v1/context/search', 'context.search');
  api.route('POST', '/v1/search', 'project.search');
  api.route('POST', '/v1/context/handoff', 'context.handoff.create');
  api.route('POST', '/v1/context/handoff/claim', 'context.handoff.claim');
  api.route('POST', '/v1/sessions', 'session.start');
  api.route('GET', '/v1/sessions/command-context', 'session.command-context');
  api.route('POST', '/v1/sessions/start/receipt', 'session.start.receipt');
  api.routeTemplate('POST', '/v1/sessions/{session_id}/runs', 'session.run.start');
  api.routeTemplate('POST', '/v1/sessions/{session_id}/runs/{run_id}/finish', 'session.run.finish');
  api.routeTemplate('GET', '/v1/sessions/{session_id}', 'session.read');
  api.routeTemplate('GET', '/v1/handoffs/{handoff_id}', 'session.handoff.read');
  api.routeTemplate('GET', '/v1/sessions/{session_id}/checkpoints', 'session.checkpoints.list');
  api.routeTemplate(
    'GET',
    '/v1/sessions/{session_id}/checkpoints/{checkpoint_id}',
    'session.checkpoint.read',
  );
  api.routeTemplate('GET', '/v1/sessions/{session_id}/runs', 'session.runs.list');
  api.routeTemplate('GET', '/v1/sessions/{session_id}/runs/{run_id}', 'session.run.read');
  api.routeTemplate('GET', '/v1/sessions/{session_id}/tool-calls', 'session.tools.list');
  api.routeTemplate(
    'GET',
    '/v1/sessions/{session_id}/tool-calls/{tool_call_id}',
    'session.tool.read',
  );
  api.routeTemplate('POST', '/v1/sessions/{session_id}/tool-calls', 'session.tool.call');
  api.routeTemplate(
    'POST',
    '/v1/sessions/{session_id}/tool-calls/{tool_call_id}/finish',
    'session.tool.finish',
  );
  api.routeTemplate('POST', '/v1/sessions/{session_id}/end', 'session.end');
  api.routeTemplate(
    'POST',
    '/v1/sessions/{session_id}/commands/receipt',
    'session.command.receipt',
  );
  api.routeTemplate('POST', '/v1/sessions/{session_id}/checkpoint', 'session.checkpoint');
  api.routeTemplate(
    'POST',
    '/v1/sessions/{session_id}/checkpoint/receipt',
    'session.checkpoint.receipt',
  );
  api.routeTemplate('POST', '/v1/sessions/{session_id}/handoff', 'session.handoff');
  api.routeTemplate('POST', '/v1/sessions/{session_id}/handoff/receipt', 'session.handoff.receipt');
  api.routeTemplate('POST', '/v1/sessions/{session_id}/resume', 'session.resume');
  api.routeTemplate('POST', '/v1/sessions/{session_id}/resume/receipt', 'session.resume.receipt');
  api.routeTemplate('POST', '/v1/handoffs/{handoff_id}/claim', 'session.handoff.claim');
  api.routeTemplate(
    'POST',
    '/v1/handoffs/{handoff_id}/claim/receipt',
    'session.handoff.claim.receipt',
  );

  let server: Server | undefined;
  let runtimeInitialized: Promise<void> | undefined;

  const requestHandler = (request: IncomingMessage, response: ServerResponse): void => {
    void handleRequest(request, response, api, {
      artifact_uploads: artifactUploads,
      artifact_downloads: artifactDownloads,
      observe_artifact_download: observeArtifactDownload,
      artifact_writes_enabled: artifactWriter !== undefined,
      oidc_verify: verifyGatewayToken,
      session_current_identity: sessionCurrentIdentity,
      host,
      port,
      version,
      search,
      resources,
      projection,
      plane_webhook_secret: options.plane_webhook_secret ?? process.env.PLANE_WEBHOOK_SECRET,
      audit,
      plane_inbox: planeInbox,
      plane_inbox_metrics: planeMetrics,
      persist_audit: persistAudit,
      memory_required: memoryRequired,
      sessions,
      continuation,
      ...(memory ? { memory_service: memory } : {}),
    });
  };

  return {
    start: async () => {
      if (auditDb) {
        runtimeInitialized ??= (async () => {
          await sessions.hydrate();
          await continuation.hydrate();
          await planeInbox!.initialize();
        })();
        await runtimeInitialized;
      }
      return new Promise<string>((resolve, reject) => {
        if (server?.listening) {
          const address = server.address();
          if (address && typeof address !== 'string') resolve(`http://${host}:${address.port}`);
          else reject(new Error('Platform server has an invalid listening address'));
          return;
        }
        server = createServer(requestHandler);
        const onError = (error: Error) => reject(error);
        server.once('error', onError);
        server.listen(port, host, () => {
          server?.off('error', onError);
          const address = server?.address();
          if (!address || typeof address === 'string') {
            reject(new Error('Platform server has an invalid listening address'));
            return;
          }
          planeInbox?.start();
          planeMetrics?.start();
          resolve(`http://${host}:${address.port}`);
        });
      });
    },
    stop: () =>
      new Promise<void>((resolve, reject) => {
        if (!server?.listening) {
          void closeStorage().then(resolve, reject);
          return;
        }
        server.close((error) => {
          server = undefined;
          if (error) {
            reject(error);
            return;
          }
          void closeStorage().then(resolve, reject);
        });
      }),
    auditRecords: () => runtimeAuditSnapshot(audit),
  };

  async function closeStorage() {
    await Promise.all([planeInbox?.stop(), planeMetrics?.stop()]);
    await Promise.all([auditDb?.end({ timeout: 5 }), planeMetricsDb?.end({ timeout: 5 })]);
  }
}

function toRouterDecision(
  decision: PolicyDecision,
): { allowed: true } | { allowed: false; reason: string } {
  return decision.allowed ? { allowed: true } : { allowed: false, reason: decision.reason };
}

function policyAction(request: CommandRequest): string {
  if (request.operation === sessionCurrentOperation) return 'context.read';
  if (request.operation === 'session.command-context') {
    if (request.context.capability.includes('context.read')) return 'context.read';
    if (
      request.context.capability.includes('session.write') ||
      request.context.roles?.includes('admin')
    )
      return 'session.write';
    return 'handoff.claim';
  }
  // Classification-aware export authorization follows the scoped record read.
  if (request.operation === 'audit.export') return 'audit.read';
  if (request.operation === 'artifact.download') return 'artifact.read';
  if (
    [
      'artifact.receipt',
      'artifact.create',
      'artifact.put-version',
      'artifact.upload-context',
    ].includes(request.operation)
  )
    return 'artifact.write';
  if (
    [
      'artifact.read',
      'artifact.version.read',
      'artifact.versions.list',
      'artifact.registry.list',
    ].includes(request.operation)
  )
    return 'artifact.read';
  if (request.operation === 'plane.inbox.retry') return 'plane.retry';
  if (request.operation.startsWith('plane.inbox.')) return 'admin.read';
  if (
    request.operation === 'mcp.catalog' &&
    ['initialize', 'ping', 'tools'].includes(String(request.input.kind))
  )
    return 'mcp.discover';
  if (['sync.append', 'sync.command-context', 'sync.event.receipt'].includes(request.operation))
    return 'sync.write';
  if (['sync.changes', 'sync.ack', 'sync.cursor'].includes(request.operation)) return 'sync.read';
  if (
    ['conflict.resolve', 'conflict.receipt', 'conflict.command-context'].includes(request.operation)
  )
    return 'conflict.resolve';
  if (['proposal.create', 'proposal.create.receipt'].includes(request.operation))
    return 'proposal.write';
  if (request.operation === 'context.item.confirm') return 'context.review';
  if (
    ['proposal.confirm', 'proposal.reject', 'proposal.review.receipt'].includes(request.operation)
  )
    return 'proposal.review';
  if (
    [
      'context.item.create',
      'context.item.update',
      'context.item.archive',
      'context.item.restore',
    ].includes(request.operation)
  )
    return 'context.write';
  if (request.operation === 'workbench.query') {
    if (request.input.operation === 'audit') return 'audit.read';
    if (request.input.operation === 'admin') return 'admin.read';
  }
  if (
    ['session.handoff.claim', 'session.handoff.claim.receipt'].includes(request.operation) &&
    request.context.capability.includes('handoff.claim')
  )
    return 'handoff.claim';
  if (
    [
      'session.read',
      'session.checkpoint.read',
      'session.checkpoints.list',
      'session.handoff.read',
      'session.runs.list',
      'session.run.read',
      'session.tools.list',
      'session.tool.read',
    ].includes(request.operation)
  )
    return 'context.read';
  if (request.operation.startsWith('session.')) return 'session.write';
  if (
    ['context.index', 'context.index.delete', 'context.index.restore'].includes(
      request.operation,
    ) ||
    request.operation.startsWith('context.handoff')
  )
    return 'context.write';
  return 'context.read';
}

function runtimeAuditSnapshot(audit: AuditService): AuditRecord[] {
  return audit.snapshot();
}

function resolveMemoryMode(value: string | undefined): MemoryProviderMode | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  if (value === 'in-memory' || value === 'ai-memory-mcp') return value;
  throw new Error(`Unsupported MEMORY_PROVIDER_MODE: ${value}`);
}

function createConfiguredMemory(
  options: PlatformServerOptions,
  mode: MemoryProviderMode,
): MemoryServiceAdapter {
  const configuration: MemoryServiceConfiguration = {
    mode,
    enabled: options.memory_enabled ?? process.env.MEMORY_ENABLED !== 'false',
  };
  if (mode === 'ai-memory-mcp') {
    const aiMemory: AiMemoryMcpProviderOptions = {
      serverUrl: options.ai_memory_server_url ?? process.env.AI_MEMORY_URL ?? '',
      actor_id: options.memory_actor_id ?? process.env.MEMORY_ACTOR_ID ?? 'planemem-api-gateway',
      client_id: options.memory_client_id ?? process.env.MEMORY_CLIENT_ID ?? 'planemem-api-gateway',
    };
    const token =
      options.ai_memory_token ?? process.env.AI_MEMORY_TOKEN ?? process.env.AI_MEMORY_AUTH_TOKEN;
    if (token) aiMemory.token = token;
    configuration.ai_memory = aiMemory;
  }
  return createMemoryService(configuration);
}

function toMemoryScope(context: RequestContext): MemoryScope {
  return {
    tenant_id: context.tenant_id as MemoryScope['tenant_id'],
    workspace_id: context.workspace_id as MemoryScope['workspace_id'],
    project_id: context.project_id as MemoryScope['project_id'],
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  api: ApiGateway,
  runtime: RuntimeState,
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${runtime.host}:${runtime.port}`);
  if (url.pathname === sessionCurrentPath) response.setHeader('cache-control', 'no-store');
  if (request.method === 'GET' && url.pathname === '/health') {
    const health = {
      service: 'planemem-platform',
      version: runtime.version,
      status: 'ok',
      ...(runtime.plane_inbox ? { plane_ingestion: runtime.plane_inbox.health() } : {}),
      ...(runtime.memory_service ? { memory: runtime.memory_service.health() } : {}),
    };
    writeJson(response, 200, health);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/health/ready') {
    const memoryHealth = runtime.memory_service?.health();
    const planeHealth = runtime.plane_inbox?.health();
    const ready =
      (!runtime.memory_required || !memoryHealth || memoryHealth.ready) &&
      planeHealth?.status !== 'degraded';
    writeJson(response, ready ? 200 : 503, {
      service: 'planemem-platform',
      version: runtime.version,
      status: ready ? 'ready' : 'not_ready',
      ready,
      ...(memoryHealth ? { memory: memoryHealth } : {}),
      ...(planeHealth ? { plane_ingestion: planeHealth } : {}),
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/version') {
    writeJson(response, 200, { version: runtime.version });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/metrics') {
    response.writeHead(200, {
      'content-type': 'text/plain; version=0.0.4',
      'cache-control': 'no-store',
    });
    const planeMetrics =
      runtime.plane_inbox_metrics && runtime.plane_inbox
        ? runtime.plane_inbox_metrics.render(runtime.plane_inbox.monitoring())
        : '# HELP planemem_plane_inbox_metrics_enabled Whether database-wide inbox metrics are enabled.\n# TYPE planemem_plane_inbox_metrics_enabled gauge\nplanemem_plane_inbox_metrics_enabled 0\n';
    response.end(
      `# planemem runtime\nplanemem_search_vector_enabled ${runtime.search.health().vector_enabled ? 1 : 0}\nplanemem_audit_records_total ${runtime.audit.health().metrics.records}\n${runtime.memory_service ? `planemem_memory_provider_ready ${runtime.memory_service.health().ready ? 1 : 0}\n` : ''}${planeMetrics}`,
    );
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/plane/webhook') {
    await handlePlaneWebhook(request, response, runtime);
    return;
  }

  if (url.pathname === '/mcp') {
    const origin = header(request, 'origin');
    const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (origin !== undefined && !allowedOrigins.includes(origin)) {
      const traceId = `trace_mcp_${createUlid()}`;
      response.setHeader('x-trace-id', traceId);
      writeJson(
        response,
        403,
        errorEnvelope('DENIED', 'MCP browser origin is not allowed', request, traceId),
      );
      return;
    }
    if (origin !== undefined) {
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('vary', 'Origin');
      response.setHeader('access-control-expose-headers', 'x-trace-id, www-authenticate');
    }
    if (
      request.method === 'OPTIONS' &&
      origin !== undefined &&
      header(request, 'access-control-request-method') === 'POST'
    ) {
      response.setHeader('access-control-allow-methods', 'POST');
      response.setHeader(
        'access-control-allow-headers',
        'authorization, content-type, mcp-protocol-version, x-tenant-id, x-workspace-id, x-project-id, x-trace-id, traceparent, idempotency-key, if-match, if-match-version',
      );
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === 'POST') {
      await handleMcpRequest(request, response, api, runtime);
      return;
    }
    response.setHeader('allow', 'POST');
    writeJson(
      response,
      405,
      errorEnvelope('METHOD_NOT_ALLOWED', 'MCP uses POST requests', request),
    );
    return;
  }

  if ((request.method !== 'GET' && request.method !== 'POST') || !url.pathname.startsWith('/v1/')) {
    writeJson(response, 404, errorEnvelope('NOT_FOUND', 'Route does not exist', request));
    return;
  }

  const traceId =
    (url.pathname === sessionCurrentPath ? header(request, 'x-trace-id') : undefined) ||
    header(request, 'traceparent') || header(request, 'x-trace-id') || `trace_http_${createUlid()}`;
  let body: RuntimeBody = {};
  const auditExportRoute = request.method === 'POST' && url.pathname === '/v1/audit/export';
  const syncEventReceiptRoute = url.pathname === '/v1/sync/events/receipt';
  const proposalCreateReceiptRoute = url.pathname === '/v1/proposals/creation-receipt';
  const proposalReviewReceiptRoute = url.pathname === '/v1/proposals/review-receipt';
  const contextPackSaveReceiptRoute = url.pathname === '/v1/context-pack/save-receipt';
  const artifactDownload =
    request.method === 'GET' &&
    /^\/v1\/artifacts\/[^/]+\/versions\/[^/]+\/content$/.test(url.pathname);
  const artifactUpload =
    request.method === 'POST' &&
    (url.pathname === '/v1/artifacts' || /^\/v1\/artifacts\/[^/]+\/versions$/.test(url.pathname));
  // Closing this connection also bounds unread data on authentication/size failures.
  if (
    artifactUpload ||
    artifactDownload ||
    auditExportRoute ||
    syncEventReceiptRoute ||
    proposalCreateReceiptRoute ||
    proposalReviewReceiptRoute ||
    contextPackSaveReceiptRoute
  ) {
    response.setHeader('connection', 'close');
    response.setHeader('x-trace-id', traceId);
  }
  if (
    request.method === 'POST' &&
    !artifactUpload &&
    !auditExportRoute &&
    !syncEventReceiptRoute &&
    !proposalCreateReceiptRoute &&
    !proposalReviewReceiptRoute &&
    !contextPackSaveReceiptRoute
  ) {
    try {
      body = url.pathname === sessionCurrentPath
        ? parseSessionCurrentRequest(await readCurrentSessionBody(request))
        : await readJson(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request body must be valid JSON';
      writeJson(response, 400, errorEnvelope('INVALID_JSON', message, request, traceId));
      return;
    }
  }

  let context: RequestContext;
  try {
    const currentSessionRoute = url.pathname === sessionCurrentPath;
    const continuityRoute = /^\/v1\/(?:sessions|handoffs)(?:\/|$)/.test(url.pathname);
    const sessionCommandContextRoute = url.pathname === '/v1/sessions/command-context';
    const conflictCommandContextRoute = url.pathname === '/v1/conflicts/commands/context';
    const syncCommandContextRoute = url.pathname === '/v1/sync/commands/context';
    const contextPackSaveContextRoute = url.pathname === '/v1/context-pack/save-context';
    const syncCursorRoute = url.pathname === '/v1/sync/cursor';
    const artifactRoute = /^\/v1\/artifacts(?:\/|$)/.test(url.pathname);
    const artifactRegistryRoute = request.method === 'GET' && url.pathname === '/v1/artifacts';
    const artifactVersionsRoute =
      request.method === 'GET' && /^\/v1\/artifacts\/[^/]+\/versions$/.test(url.pathname);
    const sessionRecordRead =
      request.method === 'GET' &&
      !sessionCommandContextRoute &&
      (/^\/v1\/sessions\/[^/]+(?:\/(runs|tool-calls|checkpoints)\/[^/]+)?$/.test(url.pathname) ||
        /^\/v1\/handoffs\/[^/]+$/.test(url.pathname));
    const sessionActivityRead =
      sessionRecordRead ||
      (request.method === 'GET' &&
        /^\/v1\/sessions\/[^/]+\/(runs|tool-calls|checkpoints)$/.test(url.pathname));
    const conflictRoute = /^\/v1\/conflicts(?:\/|$)/.test(url.pathname);
    const conflictDetailRoute =
      request.method === 'GET' &&
      !conflictCommandContextRoute &&
      /^\/v1\/conflicts\/[^/]+$/.test(url.pathname);
    const contextPackRoute = [
      '/v1/context-pack',
      '/v1/context-pack/compile',
      '/v1/context-pack/save-context',
      '/v1/context-pack/save-receipt',
      '/v1/context-packs',
    ].includes(url.pathname);
    const syncRoute = [
      '/v1/sync/changes',
      '/v1/sync/cursor',
      '/v1/sync/ack',
      '/v1/events:batch',
      '/v1/sync/commands/context',
      '/v1/sync/events/receipt',
    ].includes(url.pathname);
    const contextItemRoute = /^\/v1\/context-items(?:\/|$)/.test(url.pathname);
    const contextIndexRoute = /^\/v1\/context\/index(?:\/|$)/.test(url.pathname);
    const proposalRoute = /^\/v1\/proposals(?:\/|$)/.test(url.pathname);
    const observedReadRoute =
      /^\/v1\/(?:projects\/[^/]+\/state|work-items\/[^/]+\/(?:state|context))$/.test(url.pathname);
    const observedDirectoryRoute = url.pathname === '/v1/plane/work-items';
    const planeInboxRoute = /^\/v1\/plane\/events(?:\/|$)/.test(url.pathname);
    const authorization = header(request, 'authorization');
    if (
      currentSessionRoute || url.pathname === WORKBENCH_QUERY_PATH ||
      auditExportRoute ||
      url.pathname === '/v1/search' ||
      url.pathname === '/v1/context/search' ||
      artifactRoute ||
      contextIndexRoute ||
      observedReadRoute ||
      observedDirectoryRoute ||
      planeInboxRoute ||
      conflictRoute ||
      contextPackRoute ||
      contextItemRoute ||
      proposalRoute ||
      syncRoute ||
      sessionCommandContextRoute ||
      sessionActivityRead ||
      (continuityRoute && (runtime.oidc_verify || authorization !== undefined))
    ) {
      context = await authenticatedContext(
        {
          tenant_id: header(request, 'x-tenant-id') ?? '',
          workspace_id: header(request, 'x-workspace-id') ?? '',
          project_id: header(request, 'x-project-id') ?? '',
        },
        traceId,
        authorization,
        runtime.oidc_verify,
        currentSessionRoute || auditExportRoute ||
          conflictCommandContextRoute ||
          sessionCommandContextRoute ||
          contextPackSaveContextRoute ||
          artifactDownload ||
          artifactRegistryRoute ||
          url.pathname === '/v1/artifacts/upload-context' ||
          url.pathname === '/v1/context-packs' ||
          (artifactRoute && request.method === 'POST') ||
          (contextIndexRoute && request.method === 'POST') ||
          (planeInboxRoute && request.method === 'POST') ||
          (continuityRoute && !sessionActivityRead) ||
          syncRoute ||
          ((conflictRoute || contextPackRoute || contextItemRoute || proposalRoute) &&
            request.method === 'POST'),
      );
      // These headers are preconditions on verified claims, never identity inputs.
      if (contextPackSaveReceiptRoute) {
        if (
          request.method !== 'POST' ||
          url.searchParams.size ||
          url.hash ||
          !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
            header(request, 'content-type') ?? '',
          )
        )
          throw new ContractError(
            'INVALID_INPUT',
            'Original save receipt requires JSON POST without query or write conditions',
            { trace_id: traceId },
          );
        const entries: Array<[string, string | undefined]> = [];
        for (let i = 0; i < request.rawHeaders.length; i += 2)
          entries.push([request.rawHeaders[i]!, request.rawHeaders[i + 1]]);
        validateContextPackSaveReceiptHeaders(entries, context);
        if (!canReadContextPackSaveReceipt(context))
          throw new ContractError('DENIED', 'An original verified context reader is required', {
            trace_id: traceId,
          });
        try {
          body = await readJson(request, CONTEXT_PACK_SAVE_RECEIPT_REQUEST_BYTES);
        } catch {
          throw new ContractError(
            'INVALID_INPUT',
            'Supply complete original save receipt JSON within 4 KiB',
            { trace_id: traceId },
          );
        }
      }
      if (contextPackSaveContextRoute) {
        if (request.method !== 'GET' || url.searchParams.size || url.hash)
          throw new ContractError('INVALID_INPUT', 'Save identity is a parameter-free GET', {
            trace_id: traceId,
            retryable: false,
          });
        const entries: Array<[string, string | undefined]> = [];
        for (let i = 0; i < request.rawHeaders.length; i += 2)
          entries.push([request.rawHeaders[i]!, request.rawHeaders[i + 1]]);
        validateContextPackSaveContextHeaders(entries, context);
      }
      if (
        (sessionCommandContextRoute ||
          conflictCommandContextRoute ||
          syncCommandContextRoute ||
          syncCursorRoute) &&
        (request.method !== 'GET' ||
          url.searchParams.size ||
          header(request, 'transfer-encoding') !== undefined ||
          !['0', undefined].includes(header(request, 'content-length')) ||
          [
            'idempotency-key',
            'if-match',
            'if-match-version',
            'if-none-match',
            'if-modified-since',
            'if-unmodified-since',
            'range',
            'if-range',
          ].some((name) => header(request, name) !== undefined))
      )
        throw new ContractError(
          'INVALID_INPUT',
          'Command context is a parameter-free read without body, cache or write conditions',
          { trace_id: traceId },
        );
      if (
        url.pathname === '/v1/sync/ack' &&
        (request.method !== 'POST' ||
          url.searchParams.size ||
          !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
            header(request, 'content-type') ?? '',
          ) ||
          [
            'idempotency-key',
            'if-match',
            'if-match-version',
            'range',
            'if-range',
            'if-none-match',
            'if-modified-since',
            'if-unmodified-since',
            'content-encoding',
          ].some((name) => header(request, name) !== undefined))
      )
        throw new ContractError(
          'INVALID_INPUT',
          'Sync acknowledgement takes original identity/cursor JSON without query, key, version or cache conditions',
          { trace_id: traceId },
        );
      if (proposalCreateReceiptRoute || proposalReviewReceiptRoute) {
        if (
          request.method !== 'POST' ||
          url.searchParams.size ||
          !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
            header(request, 'content-type') ?? '',
          ) ||
          [
            'idempotency-key',
            'if-match',
            'if-match-version',
            'if-none-match',
            'if-modified-since',
            'if-unmodified-since',
            'range',
            'if-range',
            'content-encoding',
            ...(proposalReviewReceiptRoute ? ['x-expected-version'] : []),
          ].some((name) => header(request, name) !== undefined)
        )
          throw new ContractError(
            'INVALID_INPUT',
            'Proposal receipt takes the complete original request JSON without query or write/cache conditions',
            { trace_id: traceId },
          );
        try {
          body = await readJson(
            request,
            proposalReviewReceiptRoute
              ? PROPOSAL_REVIEW_RECEIPT_REQUEST_BYTES
              : PROPOSAL_CREATE_RECEIPT_REQUEST_BYTES,
          );
        } catch {
          throw new ContractError(
            'INVALID_INPUT',
            proposalReviewReceiptRoute
              ? 'Supply complete original review receipt JSON within 32 KiB'
              : 'Supply complete original proposal receipt JSON within 1 MiB',
            { trace_id: traceId },
          );
        }
      }
      if (syncEventReceiptRoute) {
        if (
          request.method !== 'POST' ||
          url.searchParams.size ||
          !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
            header(request, 'content-type') ?? '',
          ) ||
          [
            'idempotency-key',
            'if-match',
            'if-match-version',
            'if-none-match',
            'if-modified-since',
            'if-unmodified-since',
            'range',
            'if-range',
            'content-encoding',
          ].some((name) => header(request, name) !== undefined)
        )
          throw new ContractError(
            'INVALID_INPUT',
            'Sync receipt takes only original identity/event JSON without query, batch key or write/cache conditions',
            { trace_id: traceId },
          );
        try {
          body = await readJson(request, SYNC_EVENT_RECEIPT_REQUEST_BYTES);
        } catch {
          throw new ContractError(
            'INVALID_INPUT',
            'Supply complete original sync receipt JSON within the request limit',
            { trace_id: traceId },
          );
        }
      }
      if (
        auditExportRoute &&
        (url.searchParams.size ||
          !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
            header(request, 'content-type') ?? '',
          ) ||
          [
            'idempotency-key',
            'if-match',
            'if-match-version',
            'range',
            'if-range',
            'if-none-match',
            'if-modified-since',
            'if-unmodified-since',
            'content-encoding',
          ].some((name) => header(request, name) !== undefined))
      )
        throw new ContractError(
          'INVALID_INPUT',
          'Audit export accepts a JSON selection without query, cache or write conditions',
          { trace_id: traceId },
        );
      if (auditExportRoute) {
        try {
          body = await readJson(request, AUDIT_EXPORT_REQUEST_BYTES);
        } catch {
          throw new ContractError(
            'INVALID_INPUT',
            'Audit export requires a JSON object within 4 KiB',
            { trace_id: traceId },
          );
        }
      }
      for (const [name, actual] of [
        ['x-expected-actor-id', context.actor_id],
        ['x-expected-client-id', context.client_id],
      ] as const) {
        const expected = header(request, name);
        if (expected !== undefined && expected !== actual)
          throw new ContractError(
            'DENIED',
            'Authenticated identity changed since the command was queued',
            {
              trace_id: traceId,
            },
          );
      }
      if (observedReadRoute && url.searchParams.size)
        throw new ContractError('INVALID_INPUT', 'Observed reads do not accept query parameters', {
          trace_id: traceId,
        });
      if (
        conflictDetailRoute &&
        (url.searchParams.size ||
          Object.keys(body).length ||
          header(request, 'transfer-encoding') !== undefined ||
          !['0', undefined].includes(header(request, 'content-length')) ||
          [
            'idempotency-key',
            'if-match',
            'if-match-version',
            'range',
            'if-range',
            'if-none-match',
            'if-modified-since',
            'if-unmodified-since',
          ].some((name) => header(request, name) !== undefined))
      )
        throw new ContractError(
          'INVALID_INPUT',
          'Conflict detail is an unconditional read without query, body or write conditions',
          { trace_id: traceId },
        );
      if (
        artifactRoute &&
        !artifactVersionsRoute &&
        !artifactRegistryRoute &&
        url.searchParams.size
      )
        throw new ContractError(
          'INVALID_INPUT',
          'Artifact endpoints do not accept query parameters',
          { trace_id: traceId },
        );
      if (artifactVersionsRoute || artifactRegistryRoute) {
        if (
          Object.keys(body).length ||
          header(request, 'transfer-encoding') !== undefined ||
          !['0', undefined].includes(header(request, 'content-length')) ||
          [
            'idempotency-key',
            'if-match',
            'if-match-version',
            'x-expected-version',
            'range',
            'if-range',
            'if-none-match',
            'if-modified-since',
            'if-unmodified-since',
            'content-encoding',
          ].some((name) => header(request, name) !== undefined)
        )
          throw new ContractError(
            'INVALID_INPUT',
            'Artifact directories accept pagination without body, cache or write conditions',
            {
              trace_id: traceId,
            },
          );
        for (const [field, value] of url.searchParams) {
          if (artifactRegistryRoute && ['query', 'classification', 'cursor'].includes(field)) {
            if (url.searchParams.getAll(field).length !== 1)
              throw new ContractError(
                'INVALID_INPUT',
                'File directory parameters must be single values',
                { trace_id: traceId },
              );
            body[field] = value;
            continue;
          }
          if (
            !(
              artifactRegistryRoute ? ['limit'] : ['limit', 'at_version', 'before_version']
            ).includes(field) ||
            url.searchParams.getAll(field).length !== 1 ||
            !/^[1-9][0-9]{0,15}$/.test(value) ||
            !Number.isSafeInteger(Number(value))
          )
            throw new ContractError('INVALID_INPUT', 'Invalid artifact version pagination', {
              trace_id: traceId,
            });
          body[field] = Number(value);
        }
      }
      if (request.method === 'GET' && url.pathname === '/v1/conflicts') {
        if (
          header(request, 'transfer-encoding') !== undefined ||
          !['0', undefined].includes(header(request, 'content-length')) ||
          [
            'idempotency-key',
            'if-match',
            'if-match-version',
            'range',
            'if-range',
            'if-none-match',
            'if-modified-since',
            'if-unmodified-since',
          ].some((name) => header(request, name) !== undefined)
        )
          throw new ContractError(
            'INVALID_INPUT',
            'Conflict directory accepts filters without body, cache or write conditions',
            { trace_id: traceId },
          );
        for (const [field, value] of url.searchParams) {
          if (
            !['query', 'status', 'entity_type', 'conflict_id', 'limit', 'cursor'].includes(field) ||
            url.searchParams.getAll(field).length !== 1 ||
            (field === 'limit' && !/^[1-9][0-9]{0,2}$/.test(value))
          )
            throw new ContractError('INVALID_INPUT', 'Invalid conflict directory query', {
              trace_id: traceId,
            });
          body[field] = field === 'limit' ? Number(value) : value;
        }
      }
      if (
        url.pathname === '/v1/conflicts/receipt' &&
        request.method === 'POST' &&
        (url.searchParams.size ||
          [
            'idempotency-key',
            'if-match',
            'if-match-version',
            'range',
            'if-range',
            'if-none-match',
            'if-modified-since',
            'if-unmodified-since',
          ].some((name) => header(request, name) !== undefined))
      )
        throw new ContractError(
          'INVALID_INPUT',
          'Conflict receipt accepts the original request without query parameters or outer write/cache conditions',
          { trace_id: traceId },
        );
      if (
        ((url.pathname === '/v1/artifacts/receipt' && request.method === 'POST') ||
          url.pathname === '/v1/artifacts/upload-context') &&
        ['idempotency-key', 'if-match', 'if-match-version'].some(
          (name) => header(request, name) !== undefined,
        )
      )
        throw new ContractError(
          'INVALID_INPUT',
          'Artifact receipt and upload context queries do not accept write headers',
          {
            trace_id: traceId,
          },
        );
      if (observedDirectoryRoute && url.searchParams.size) {
        for (const [field, value] of url.searchParams) {
          if (
            request.method !== 'GET' ||
            !['query', 'state', 'limit', 'cursor'].includes(field) ||
            url.searchParams.getAll(field).length !== 1 ||
            (field === 'limit' && !/^[1-9][0-9]{0,2}$/.test(value))
          )
            throw new ContractError(
              'INVALID_INPUT',
              'Invalid observation directory query parameters',
              { trace_id: traceId },
            );
          body[field] = field === 'limit' ? Number(value) : value;
        }
      }
      if (planeInboxRoute && url.searchParams.size) {
        for (const [field, value] of url.searchParams) {
          if (
            request.method !== 'GET' ||
            url.pathname !== '/v1/plane/events' ||
            !['status', 'pending_state', 'aggregate_id', 'limit', 'cursor'].includes(field) ||
            url.searchParams.getAll(field).length !== 1 ||
            (field === 'limit' && !/^[1-9][0-9]{0,2}$/.test(value))
          )
            throw new ContractError('INVALID_INPUT', 'Invalid inbox query parameters', {
              trace_id: traceId,
            });
          body[field] = field === 'limit' ? Number(value) : value;
        }
      }
      if (request.method === 'GET' && url.pathname === '/v1/proposals/submission-context') {
        if (url.searchParams.size)
          throw new ContractError(
            'INVALID_INPUT',
            'Submission context does not accept query parameters',
            { trace_id: traceId },
          );
        if (context.authenticated_client !== true)
          throw new ContractError('DENIED', 'An authenticated client is required', {
            trace_id: traceId,
          });
        // Only the caller's own authenticated scope/identity and protocol version.
        // This does not grant proposal.write or claim storage is ready.
        writeJson(
          response,
          200,
          {
            schema_version: 1,
            trace_id: traceId,
            source_refs: [],
            data: {
              identity_preconditions: 1,
              actor_id: context.actor_id,
              client_id: context.client_id,
              tenant_id: context.tenant_id,
              workspace_id: context.workspace_id,
              project_id: context.project_id,
            },
          },
          { 'cache-control': 'no-store' },
        );
        return;
      }
      if (
        continuityRoute ||
        conflictRoute ||
        syncRoute ||
        contextPackRoute ||
        contextItemRoute ||
        contextIndexRoute ||
        planeInboxRoute ||
        proposalRoute
      ) {
        // The signed client/actor owns the command. Never accept an identity override from its payload.
        for (const [field, identity] of [
          ['client_id', context.client_id],
          ['from_client', context.client_id],
          ['actor_id', context.actor_id],
          ['tenant_id', context.tenant_id],
          ['workspace_id', context.workspace_id],
          ['project_id', context.project_id],
        ] as const) {
          if (body[field] !== undefined && body[field] !== identity)
            throw new ContractError(
              'DENIED',
              'Command identity does not match the authenticated caller',
              { trace_id: traceId },
            );
        }
        if (
          /^\/v1\/sessions\/[^/]+\/resume$/.test(url.pathname) &&
          context.client_id === (process.env.AUTH_SERVER_CLIENT_ID ?? 'PlaneMem_WebConsole')
        )
          body.require_claimed = true;
        readPreconditions(request, context);
        if (contextIndexRoute && url.searchParams.size) {
          for (const [field, value] of url.searchParams) {
            if (
              request.method !== 'GET' ||
              url.pathname !== '/v1/context/index' ||
              !['query', 'state', 'managed_by', 'limit', 'cursor'].includes(field) ||
              url.searchParams.getAll(field).length !== 1 ||
              (field === 'limit' && !/^[1-9]\d{0,2}$/.test(value))
            )
              throw new ContractError(
                'INVALID_INPUT',
                'Only the index list accepts query/state/managed_by/limit/cursor',
                { trace_id: traceId },
              );
            body[field] = field === 'limit' ? Number(value) : value;
          }
        }
        if (sessionActivityRead) {
          const allowed = sessionRecordRead
            ? []
            : url.pathname.endsWith('/checkpoints')
              ? ['before_revision']
              : url.pathname.endsWith('/runs')
                ? ['before_sequence', 'limit']
                : ['run_id', 'before_id', 'limit'];
          for (const [field, value] of url.searchParams) {
            if (
              !allowed.includes(field) ||
              url.searchParams.getAll(field).length !== 1 ||
              (['before_sequence', 'before_revision', 'limit'].includes(field) &&
                !/^\d+$/.test(value))
            )
              throw new ContractError(
                'INVALID_INPUT',
                'Invalid session activity query parameters',
                { trace_id: traceId },
              );
            body[field] = ['before_sequence', 'before_revision', 'limit'].includes(field)
              ? Number(value)
              : value;
          }
        }
        if (proposalRoute) {
          for (const [field, value] of url.searchParams) {
            if (
              request.method !== 'GET' ||
              url.pathname !== '/v1/proposals' ||
              !['status', 'kind', 'before', 'limit', 'derived_from'].includes(field) ||
              url.searchParams.getAll(field).length !== 1
            )
              throw new ContractError('INVALID_INPUT', 'Invalid proposal query parameters', {
                trace_id: traceId,
              });
            if (field === 'limit' && !/^\d+$/.test(value))
              throw new ContractError('INVALID_INPUT', 'limit must be an integer', {
                trace_id: traceId,
              });
            body[field] = field === 'limit' ? Number(value) : value;
          }
        }
        if (contextItemRoute && url.searchParams.size) {
          for (const [field, value] of url.searchParams) {
            if (
              request.method !== 'GET' ||
              !/^\/v1\/context-items\/[^/]+\/history$/.test(url.pathname) ||
              !['before_version', 'limit'].includes(field) ||
              url.searchParams.getAll(field).length !== 1 ||
              !/^[1-9]\d{0,15}$/.test(value) ||
              !Number.isSafeInteger(Number(value))
            )
              throw new ContractError(
                'INVALID_INPUT',
                'Only history accepts single positive before_version and limit parameters',
                { trace_id: traceId },
              );
            body[field] = Number(value);
          }
        }
        if (contextPackRoute && request.method === 'GET') {
          const directory = url.pathname === '/v1/context-packs';
          if (
            directory &&
            (header(request, 'transfer-encoding') !== undefined ||
              !['0', undefined].includes(header(request, 'content-length')) ||
              [
                'idempotency-key',
                'if-match',
                'if-match-version',
                'if-none-match',
                'if-modified-since',
                'if-unmodified-since',
                'range',
                'if-range',
              ].some((name) => header(request, name) !== undefined))
          )
            throw new ContractError(
              'INVALID_INPUT',
              'Saved pack directory is a read without body, cache or write conditions',
              { trace_id: traceId },
            );
          for (const [field, value] of url.searchParams) {
            if (
              !(directory ? ['pack_id', 'limit', 'cursor'] : ['pack_id', 'format']).includes(
                field,
              ) ||
              url.searchParams.getAll(field).length !== 1 ||
              (directory && field === 'limit' && !/^[1-9][0-9]{0,2}$/.test(value))
            )
              throw new ContractError(
                'INVALID_INPUT',
                directory
                  ? 'Use single pack_id, limit and cursor parameters'
                  : 'Only single pack_id and format query parameters are accepted',
                { trace_id: traceId },
              );
            body[field] = directory && field === 'limit' ? Number(value) : value;
          }
        }
        if (syncRoute && request.method === 'GET') {
          if (
            url.pathname === '/v1/sync/changes' &&
            (Array.from(url.searchParams.keys()).some(
              (field) => !['cursor', 'limit'].includes(field),
            ) ||
              header(request, 'transfer-encoding') !== undefined ||
              !['0', undefined].includes(header(request, 'content-length')) ||
              [
                'idempotency-key',
                'if-match',
                'if-match-version',
                'range',
                'if-range',
                'if-none-match',
                'if-modified-since',
                'if-unmodified-since',
              ].some((name) => header(request, name) !== undefined))
          )
            throw new ContractError(
              'INVALID_INPUT',
              'Sync changes accepts only cursor and limit without body, cache or write conditions',
              {
                trace_id: traceId,
              },
            );
          for (const field of ['cursor', 'limit']) {
            const values = url.searchParams.getAll(field);
            if (!values.length) continue;
            const value = values[0]!;
            if (values.length !== 1 || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
              throw new ContractError(
                'INVALID_INPUT',
                field + ' must be a single non-negative integer',
                { trace_id: traceId },
              );
            body[field] = Number(value);
          }
        }
      }
    } else {
      context = requestContext(request, traceId);
    }
  } catch (error) {
    const envelope = serializeEnvelope(error, traceId);
    const status =
      envelope.code === 'UNAUTHENTICATED'
        ? 401
        : envelope.code === 'DENIED'
          ? 403
          : envelope.code === 'WORKBENCH_AUTH_UNAVAILABLE'
            ? 503
            : 400;
    writeJson(response, status, envelope);
    return;
  }

  if (artifactDownload) {
    let release: (() => void) | undefined;
    response.setHeader('connection', 'close');
    response.setHeader('x-trace-id', traceId);
    try {
      if (context.authenticated_client !== true || !context.capability.includes('artifact.read'))
        throw new ContractError(
          'ARTIFACT_ACCESS_DENIED',
          'A verified artifact reader is required',
          { trace_id: traceId },
        );
      if (
        [
          'range',
          'if-range',
          'if-match',
          'if-match-version',
          'if-none-match',
          'if-modified-since',
          'if-unmodified-since',
          'idempotency-key',
          'transfer-encoding',
        ].some((name) => header(request, name) !== undefined) ||
        (header(request, 'content-length') !== undefined &&
          header(request, 'content-length') !== '0')
      )
        throw new ContractError(
          'INVALID_INPUT',
          'Downloads accept no body, range, conditional cache or write headers',
          { trace_id: traceId },
        );
      const parts = url.pathname.split('/');
      const version = parts[5];
      const size = header(request, 'x-expected-artifact-size');
      if (
        !version ||
        !/^[1-9][0-9]{0,15}$/.test(version) ||
        !size ||
        !/^(0|[1-9][0-9]{0,15})$/.test(size)
      )
        throw new ContractError(
          'INVALID_INPUT',
          'Supply the selected positive version and expected byte length',
          { trace_id: traceId },
        );
      let query;
      try {
        query = parseArtifactDownloadQuery({
          artifact_id: decodeURIComponent(parts[3] ?? ''),
          version: Number(version),
          sha256: header(request, 'x-expected-artifact-sha256'),
          size: Number(size),
        });
      } catch {
        throw new ContractError('INVALID_INPUT', 'Invalid pinned artifact download descriptor', {
          trace_id: traceId,
        });
      }
      release = runtime.artifact_downloads.acquire(traceId);
      const result = await api.handle({
        method: 'GET',
        path: url.pathname,
        body: { sha256: query.sha256, size: String(query.size) },
        headers: {},
        context,
      });
      if (result.status !== 200) {
        writeJson(response, result.status, result.body, result.headers);
        return;
      }
      const delivery = artifactDownloadDelivery(result.body, query, context);
      const outcome = await sendArtifactDownload(response, delivery, traceId);
      release();
      await runtime.observe_artifact_download?.(context, query, {
        kind: 'transport',
        transport: 'http',
        outcome,
        release_audit_id: delivery.audit_id,
      });
    } catch (error) {
      if (response.headersSent || response.destroyed) response.destroy();
      else {
        const envelope = serializeEnvelope(
          error instanceof ContractError
            ? error
            : new ContractError(
                'ARTIFACT_STORED_INVALID',
                'Artifact download could not be prepared',
                { trace_id: traceId },
              ),
          traceId,
        );
        const status =
          envelope.code === 'ARTIFACT_DOWNLOAD_BUSY'
            ? 503
            : envelope.code === 'ARTIFACT_ACCESS_DENIED'
              ? 403
              : envelope.code === 'ARTIFACT_STORED_INVALID'
                ? 500
                : 400;
        writeJson(response, status, envelope);
      }
    } finally {
      release?.();
    }
    return;
  }

  if (artifactUpload) {
    let release: (() => void) | undefined;
    try {
      if (context.authenticated_client !== true || !context.capability.includes('artifact.write'))
        throw new ContractError(
          'ARTIFACT_ACCESS_DENIED',
          'A verified artifact writer is required',
          { trace_id: traceId },
        );
      if (!runtime.artifact_writes_enabled)
        throw new ContractError(
          'ARTIFACT_STORAGE_UNAVAILABLE',
          'Persistent artifact writes are not configured',
          { trace_id: traceId },
        );
      const appending = url.pathname !== '/v1/artifacts';
      if (
        header(request, 'idempotency-key') === undefined ||
        header(request, 'if-match-version') !== undefined ||
        (appending
          ? header(request, 'if-match') === undefined
          : header(request, 'if-match') !== undefined)
      )
        throw new ContractError(
          'INVALID_INPUT',
          'Supply Idempotency-Key and, for append only, If-Match',
          { trace_id: traceId },
        );
      readPreconditions(request, context);
      try {
        validateIdempotencyKey(context.idempotency_key);
      } catch {
        throw new ContractError('INVALID_INPUT', 'Invalid original Idempotency-Key', {
          trace_id: traceId,
        });
      }
      release = runtime.artifact_uploads.acquire(traceId);
      const upload = await readArtifactUpload(request, runtime.artifact_uploads.maxBytes, traceId);
      const result = await api.handle({
        method: 'POST',
        path: url.pathname,
        body: upload,
        headers: { 'idempotency-key': context.idempotency_key },
        context,
      });
      writeJson(response, result.status, result.body, result.headers);
    } catch (error) {
      const envelope = serializeEnvelope(
        error instanceof ContractError
          ? error
          : new ContractError(
              'INTERNAL_ERROR',
              'Artifact upload could not be completed; keep the original request',
              { trace_id: traceId },
            ),
        traceId,
      );
      const status =
        envelope.code === 'ARTIFACT_TOO_LARGE'
          ? 413
          : envelope.code === 'INTERNAL_ERROR'
            ? 500
            : envelope.code === 'ARTIFACT_UPLOAD_TIMEOUT'
              ? 408
              : envelope.code === 'ARTIFACT_ACCESS_DENIED'
                ? 403
                : ['ARTIFACT_STORAGE_UNAVAILABLE', 'ARTIFACT_UPLOAD_BUSY'].includes(envelope.code)
                  ? 503
                  : 400;
      writeJson(response, status, envelope);
    } finally {
      release?.();
    }
    return;
  }

  if (
    context.expected_version !== undefined &&
    body.expected_version !== undefined &&
    body.expected_version !== context.expected_version
  ) {
    writeJson(
      response,
      400,
      errorEnvelope('INVALID_REQUEST_CONTEXT', 'Version preconditions disagree', request, traceId),
    );
    return;
  }
  const method = request.method as HttpRequest['method'];
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once('aborted', abort);
  response.once('close', abort);
  if (request.aborted || response.destroyed) abort();
  try {
    const dispatch = () => api.handle({
      method,
      path: url.pathname,
      body,
      headers: {
        'content-type': header(request, 'content-type'),
        'idempotency-key': header(request, 'idempotency-key'),
        'x-expected-actor-id': header(request, 'x-expected-actor-id'),
        'x-expected-client-id': header(request, 'x-expected-client-id'),
      },
      context,
      signal: controller.signal,
    });
    const result = url.pathname === sessionCurrentPath && runtime.session_current_identity
      ? await runtime.session_current_identity.run(context, header(request, 'authorization'), dispatch)
      : await dispatch();
    if (!controller.signal.aborted) writeJson(response, result.status, result.body, result.headers);
  } catch (error) {
    if (url.pathname !== sessionCurrentPath) throw error;
    if (!controller.signal.aborted) writeJson(response, 403,
      errorEnvelope('DENIED', 'Current session authorization is unavailable', request, traceId));
  } finally {
    request.off('aborted', abort);
    response.off('close', abort);
  }
}

async function handlePlaneWebhook(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: RuntimeState,
): Promise<void> {
  const traceId =
    header(request, 'x-trace-id') ??
    header(request, 'traceparent') ??
    `trace_webhook_${createUlid()}`;
  if (!runtime.plane_webhook_secret) {
    writeJson(
      response,
      503,
      errorEnvelope(
        'WEBHOOK_SECRET_NOT_CONFIGURED',
        'Plane webhook secret is not configured',
        request,
        traceId,
      ),
    );
    return;
  }
  let rawBody: string;
  try {
    rawBody = await readRaw(request);
  } catch (error) {
    writeJson(
      response,
      400,
      errorEnvelope(
        'WEBHOOK_BODY_INVALID',
        error instanceof Error ? error.message : 'Webhook body is invalid',
        request,
        traceId,
      ),
    );
    return;
  }
  const headers: WebhookHeaders = { 'x-trace-id': traceId };
  const deliveryId = header(request, 'x-plane-delivery-id');
  const eventId = header(request, 'x-plane-event-id');
  const timestamp = header(request, 'x-plane-timestamp');
  const signature = header(request, 'x-plane-signature');
  if (deliveryId !== undefined) headers['x-plane-delivery-id'] = deliveryId;
  if (eventId !== undefined) headers['x-plane-event-id'] = eventId;
  if (timestamp !== undefined) headers['x-plane-timestamp'] = timestamp;
  if (signature !== undefined) headers['x-plane-signature'] = signature;
  const verification = await verifyWebhook(rawBody, headers, runtime.plane_webhook_secret);
  if (!verification.valid) {
    writeJson(response, 401, verification.error);
    return;
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch (error) {
    writeJson(
      response,
      400,
      errorEnvelope(
        'WEBHOOK_BODY_INVALID',
        error instanceof Error ? error.message : 'Webhook body must be valid JSON',
        request,
        verification.trace_id,
      ),
    );
    return;
  }
  const validated = validateEvent(body);
  if (!validated.valid) {
    writeJson(response, 400, validated.error);
    return;
  }
  const event = validated.event;
  if (event.event_id !== verification.event_id) {
    writeJson(
      response,
      400,
      errorEnvelope(
        'WEBHOOK_EVENT_ID_MISMATCH',
        'Webhook header event id does not match the canonical event',
        request,
        event.trace_id,
      ),
    );
    return;
  }
  if (!observedEntityKind(event)) {
    writeJson(
      response,
      400,
      errorEnvelope(
        'PLANE_EVENT_UNSUPPORTED',
        'Webhook requires an observed Plane project or work item event',
        request,
        event.trace_id,
      ),
    );
    return;
  }
  let consumed: PlaneDeliveryResult;
  try {
    if (!runtime.plane_inbox)
      throw new ContractError(
        'PLANE_INBOX_UNAVAILABLE',
        'Plane observations require durable database storage',
        { trace_id: event.trace_id, retryable: true },
      );
    consumed = await runtime.plane_inbox.receive(
      event,
      verification.delivery_id,
      verification.raw_hash,
    );
    const auditRecord = runtime.audit.recordAudit({
      tenant_id: event.tenant_id as never,
      workspace_id: event.workspace_id as never,
      project_id: (event.project_id ?? event.aggregate_id) as never,
      actor_id: 'plane-webhook',
      client_id: 'plane',
      action: 'plane.webhook',
      resource: `plane:${event.aggregate_type}:${event.aggregate_id}`,
      result: consumed.status === 'rejected' ? 'error' : 'allowed',
      classification: event.sensitivity,
      details: { status: consumed.status, event_id: event.event_id, durable: consumed.durable },
      trace_id: event.trace_id,
      source_refs: event.source_refs,
      idempotency_key: JSON.stringify([
        'plane-webhook',
        event.tenant_id,
        event.workspace_id,
        event.project_id ?? event.aggregate_id,
        verification.delivery_id,
      ]),
    });
    if (runtime.persist_audit) await runtime.persist_audit(auditRecord);
  } catch (error) {
    if (error instanceof ContractError) {
      const code = error.envelope.code;
      const status = error.envelope.retryable
        ? 503
        : code === 'PLANE_INBOX_INVALID'
          ? 500
          : code.endsWith('_CONFLICT')
            ? 409
            : 400;
      writeJson(response, status, error.envelope);
      return;
    }
    writeJson(
      response,
      503,
      new ContractError(
        'RUNTIME_PERSISTENCE_UNAVAILABLE',
        'Runtime persistence is unavailable; retry the same event and delivery.',
        { trace_id: event.trace_id, retryable: true },
      ).envelope,
    );
    return;
  }
  writeJson(
    response,
    consumed.status === 'queued' ? 202 : consumed.status === 'rejected' ? 409 : 200,
    {
      schema_version: 1,
      status: consumed.status,
      event_id: event.event_id,
      delivery_id: verification.delivery_id,
      effect_applied: consumed.effect_applied,
      durable: consumed.durable,
      trace_id: event.trace_id,
      source_refs: event.source_refs,
      ...(consumed.error === undefined ? {} : { error: consumed.error }),
    },
  );
}

async function handleMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  api: ApiGateway,
  runtime: RuntimeState,
): Promise<void> {
  const traceId =
    header(request, 'traceparent') || header(request, 'x-trace-id') || `trace_mcp_${createUlid()}`;
  response.setHeader('x-trace-id', traceId);
  const protocolVersion = header(request, 'mcp-protocol-version');
  if (protocolVersion !== undefined && !MCP_PROTOCOL_VERSIONS.includes(protocolVersion)) {
    writeJson(
      response,
      400,
      errorEnvelope(
        'MCP_PROTOCOL_UNSUPPORTED',
        'Unsupported MCP protocol version header',
        request,
        traceId,
      ),
    );
    return;
  }
  let context: RequestContext;
  try {
    context = await authenticatedContext(
      {
        tenant_id: header(request, 'x-tenant-id') ?? '',
        workspace_id: header(request, 'x-workspace-id') ?? '',
        project_id: header(request, 'x-project-id') ?? '',
      },
      traceId,
      header(request, 'authorization'),
      runtime.oidc_verify,
      false,
    );
    readPreconditions(request, context);
  } catch (error) {
    response.setHeader('connection', 'close');
    const failure = serializeEnvelope(error, traceId);
    const status =
      failure.code === 'UNAUTHENTICATED'
        ? 401
        : failure.code === 'DENIED'
          ? 403
          : failure.code === 'WORKBENCH_AUTH_UNAVAILABLE'
            ? 503
            : 400;
    if (status === 401) response.setHeader('www-authenticate', 'Bearer');
    writeJson(response, status, failure);
    return;
  }
  const uploadLease: { release?: () => void } = {};
  let body: RuntimeBody;
  try {
    const syncWriter = canReadSyncCommandContext(context);
    const proposalWriter = canReadProposalCreateReceipt(context);
    const reserveUpload = () => {
      if (!canUploadArtifactTool(context))
        throw new ContractError(
          'DENIED',
          'A verified artifact writer is required for artifact content expansion',
          { trace_id: traceId },
        );
      uploadLease.release ??= runtime.artifact_uploads.acquire(traceId);
    };
    const parsed = await readMcpJson(
      request,
      Math.max(
        MCP_JSON_BODY_BYTES,
        syncWriter ? MCP_SYNC_HTTP_BYTES : 0,
        proposalWriter ? MCP_PROPOSAL_RECEIPT_HTTP_BYTES : 0,
      ),
      traceId,
      canUploadArtifactTool(context)
        ? {
            maximum: MCP_ARTIFACT_UPLOAD_BODY_BYTES,
            acquire: reserveUpload,
          }
        : undefined,
    );
    body = parsed.body;
    const params = isRecord(body.params) ? body.params : {};
    const uploading = body.method === 'tools/call' && isArtifactUploadTool(params.name);
    const preparingArtifact =
      body.method === 'tools/call' && params.name === 'prepare_artifact_upload';
    const originalSync =
      body.method === 'tools/call' &&
      (params.name === 'get_sync_event_receipt' || params.name === 'upload_events') &&
      canReadSyncCommandContext(context) &&
      parsed.bytes <= MCP_SYNC_HTTP_BYTES;
    const originalProposal =
      body.method === 'tools/call' &&
      params.name === 'get_proposal_create_receipt' &&
      canReadProposalCreateReceipt(context) &&
      parsed.bytes <= MCP_PROPOSAL_RECEIPT_HTTP_BYTES;
    if (
      parsed.bytes > MCP_JSON_BODY_BYTES &&
      !uploading &&
      !preparingArtifact &&
      !originalSync &&
      !originalProposal
    )
      throw new ContractError(
        'ARTIFACT_TOO_LARGE',
        'Only authorized artifact uploads/preparations, bounded original sync uploads or original sync/proposal receipt queries may exceed the ordinary MCP body limit',
        { trace_id: traceId },
      );
    // Original-request writers may buffer their small envelope allowance before the tool name is known.
    // Artifact bodies above the ordinary limit reserve capacity before preparation or upload.
    if ((uploading || preparingArtifact) && parsed.bytes > MCP_JSON_BODY_BYTES) reserveUpload();
    if (uploading && parsed.bytes > MCP_JSON_BODY_BYTES && !runtime.artifact_writes_enabled)
      throw new ContractError(
        'ARTIFACT_STORAGE_UNAVAILABLE',
        'Persistent artifact writes are not configured',
        { trace_id: traceId },
      );
    if (
      body.method === 'tools/call' &&
      mcpToolRequiresClient(params.name) &&
      context.authenticated_client !== true
    )
      throw new ContractError('DENIED', 'This operation requires an authenticated client', {
        trace_id: traceId,
      });
    if (!uploading && !preparingArtifact) {
      uploadLease.release?.();
      delete uploadLease.release;
    }
  } catch (error) {
    uploadLease.release?.();
    response.setHeader('connection', 'close');
    const failure = error instanceof ContractError ? error.envelope : undefined;
    const status =
      failure?.code === 'ARTIFACT_TOO_LARGE'
        ? 413
        : failure?.code === 'ARTIFACT_UPLOAD_TIMEOUT'
          ? 408
          : failure?.code === 'DENIED'
            ? 403
            : ['ARTIFACT_UPLOAD_BUSY', 'ARTIFACT_STORAGE_UNAVAILABLE'].includes(failure?.code ?? '')
              ? 503
              : 400;
    writeJson(
      response,
      status,
      rpcError(null, failure ? -32602 : -32700, failure?.message ?? 'Invalid JSON-RPC body', {
        ...failure,
        trace_id: traceId,
        dispatch_state: 'not-sent',
      }),
    );
    return;
  }
  const downloadLease: { release?: () => void } = {};
  try {
    const reply = await dispatchMcp(
      body,
      context,
      api,
      runtime.version,
      {
        gate: runtime.artifact_downloads,
        ...(runtime.observe_artifact_download
          ? { observe: runtime.observe_artifact_download }
          : {}),
        retain: (release, receipt) => {
          const transport = observeArtifactDownloadTransport(response);
          downloadLease.release = transport.fail;
          void transport.completion
            .then(async (outcome) => {
              release();
              delete downloadLease.release;
              await runtime.observe_artifact_download?.(context, receipt.query, {
                kind: 'transport',
                transport: 'mcp',
                outcome,
                release_audit_id: receipt.release_audit_id,
              });
            })
            .catch(() => undefined);
          try {
            if (!response.destroyed && !response.writableFinished)
              response.setHeader('x-content-type-options', 'nosniff');
          } catch (error) {
            transport.fail();
            throw error;
          }
        },
      },
      {
        gate: runtime.artifact_uploads,
        takeReservation: () => {
          const release = uploadLease.release;
          delete uploadLease.release;
          return release;
        },
      },
    );
    if (response.destroyed) {
      downloadLease.release?.();
      return;
    }
    if (reply === null) {
      response.writeHead(202);
      response.end();
      return;
    }
    writeJson(response, 200, reply);
  } catch (error) {
    downloadLease.release?.();
    throw error;
  } finally {
    uploadLease.release?.();
  }
}
function registerResource(resources: Map<string, RuntimeResource>, hit: SearchHit): void {
  const uri = `wcp://context/${encodeURIComponent(hit.id)}`;
  resources.set(resourceKey(hit, uri), {
    uri,
    mimeType: 'text/markdown',
    text: `# ${hit.title}\n\n${hit.snippet}\n`,
    tenant_id: hit.tenant_id,
    workspace_id: hit.workspace_id,
    project_id: hit.project_id,
    source_refs: hit.source_refs.map((ref) => ({ ...ref })),
  });
}

function uniqueSourceRefs(
  refs: Array<{ type: string; id: string }>,
): Array<{ type: string; id: string }> {
  return refs.filter(
    (ref, index, all) =>
      all.findIndex((candidate) => candidate.type === ref.type && candidate.id === ref.id) ===
      index,
  );
}

function requestContext(request: IncomingMessage, trace_id: string): RequestContext {
  const context: RequestContext = {
    tenant_id: requiredHeader(request, 'x-tenant-id', trace_id),
    workspace_id: requiredHeader(request, 'x-workspace-id', trace_id),
    project_id: requiredHeader(request, 'x-project-id', trace_id),
    actor_id: requiredHeader(request, 'x-actor-id', trace_id),
    client_id: requiredHeader(request, 'x-client-id', trace_id),
    trace_id,
    capability: (header(request, 'x-capability') ?? '')
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean),
    schema_version: 1,
  };
  const roles = header(request, 'x-role');
  if (roles !== undefined) context.roles = roles.split(/[\s,]+/).filter(Boolean);
  const tokenExpiresAt = header(request, 'x-token-expires-at');
  if (tokenExpiresAt !== undefined) context.token_expires_at = tokenExpiresAt;
  readPreconditions(request, context);
  return context;
}

function readPreconditions(request: IncomingMessage, context: RequestContext): void {
  const { trace_id } = context;
  const idempotencyKey = header(request, 'idempotency-key');
  const expectedVersion = header(request, 'if-match-version');
  if (idempotencyKey !== undefined) context.idempotency_key = idempotencyKey;
  if (expectedVersion !== undefined) {
    const parsed = Number(expectedVersion);
    if (!/^\d+$/.test(expectedVersion) || !Number.isSafeInteger(parsed))
      throw new ContractError(
        'INVALID_REQUEST_CONTEXT',
        'if-match-version must be a non-negative integer',
        {
          trace_id,
          retryable: false,
        },
      );
    context.expected_version = parsed;
  }
  const etag = header(request, 'if-match');
  if (etag !== undefined) {
    let version: number;
    try {
      version = parseEtag(etag);
    } catch {
      throw new ContractError('INVALID_REQUEST_CONTEXT', 'Invalid If-Match version tag', {
        trace_id,
      });
    }
    if (context.expected_version !== undefined && context.expected_version !== version)
      throw new ContractError('INVALID_REQUEST_CONTEXT', 'Version headers disagree', { trace_id });
    context.expected_version = version;
  }
}

function requiredHeader(request: IncomingMessage, name: string, trace_id: string): string {
  const value = header(request, name);
  if (!value)
    throw new ContractError('INVALID_REQUEST_CONTEXT', `Missing required header: ${name}`, {
      field: name,
      trace_id,
      retryable: false,
    });
  return value;
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readJson(request: IncomingMessage, maximum = MAX_BODY_BYTES): Promise<RuntimeBody> {
  const raw = await readRaw(request, maximum);
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('Request body must be a JSON object');
  return parsed as RuntimeBody;
}

async function readCurrentSessionBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > 4096) throw new Error('Current session request exceeds 4 KiB');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function readRaw(request: IncomingMessage, maximum = MAX_BODY_BYTES): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maximum) throw new Error(`Request body exceeds ${maximum} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'private, no-store',
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function errorEnvelope(
  code: string,
  message: string,
  request: IncomingMessage,
  trace_id = header(request, 'traceparent') ?? 'trace_http_unknown',
): Record<string, unknown> {
  return { code, message, details: {}, trace_id, retryable: false };
}

function serializeEnvelope(error: unknown, trace_id: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(serializeError(error)) as Record<string, unknown>;
    if (parsed.trace_id === 'trace_unknown') parsed.trace_id = trace_id;
    return parsed;
  } catch {
    return errorEnvelope(
      'INTERNAL_ERROR',
      'Unknown error',
      { headers: {} } as IncomingMessage,
      trace_id,
    );
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new ContractError('INVALID_INPUT', `${field} must be a non-empty string`, {
      field,
      retryable: false,
    });
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
    throw new ContractError('INVALID_INPUT', `${field} must be an array of strings`, {
      field,
      retryable: false,
    });
  return value as string[];
}

function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    throw new ContractError('INVALID_INPUT', `${field} must be one of ${allowed.join(', ')}`, {
      field,
      retryable: false,
    });
  return value as T;
}

function projectScope(request: { context: RequestContext }): {
  tenant_id: Ulid;
  workspace_id: Ulid;
  project_id: Ulid;
} {
  return {
    tenant_id: request.context.tenant_id as Ulid,
    workspace_id: request.context.workspace_id as Ulid,
    project_id: request.context.project_id as Ulid,
  };
}

function idempotencyFor(request: { context: RequestContext; input: RuntimeBody }): string {
  return requireString(
    request.context.idempotency_key ?? request.input.idempotency_key,
    'idempotency_key',
  );
}

function expectedVersion(request: { context: RequestContext; input: RuntimeBody }): number {
  return requireInteger(
    request.context.expected_version ?? request.input.expected_version,
    'expected_version',
  );
}

function sessionMutationReceipt(request: CommandRequest) {
  assertSessionWriter(request);
  let key: string;
  try {
    key = validateIdempotencyKey(request.context.idempotency_key ?? request.input.idempotency_key);
    if (
      request.context.idempotency_key !== undefined &&
      request.input.idempotency_key !== undefined &&
      request.context.idempotency_key !== request.input.idempotency_key
    )
      throw new TypeError();
  } catch {
    throw new ContractError('INVALID_INPUT', 'A stable, matching idempotency key is required', {
      trace_id: request.context.trace_id,
    });
  }
  return commandReceipt(request, key);
}

function assertSessionWriter(request: CommandRequest): void {
  if (request.context.authenticated_client !== true)
    throw new ContractError('DENIED', 'A verified client is required for session writes', {
      trace_id: request.context.trace_id,
    });
  if (
    (request.input.actor_id !== undefined && request.input.actor_id !== request.context.actor_id) ||
    (request.input.client_id !== undefined && request.input.client_id !== request.context.client_id)
  )
    throw new ContractError(
      'INVALID_INPUT',
      'Session actor and client must match the verified identity',
      { trace_id: request.context.trace_id },
    );
}

function commandResult(
  request: { context: RequestContext },
  data: unknown,
  source_refs: Array<{ type: string; id: string }>,
): {
  schema_version: 1;
  trace_id: string;
  source_refs: Array<{ type: string; id: string }>;
  data: unknown;
} {
  return {
    schema_version: 1,
    trace_id: request.context.trace_id,
    source_refs,
    data,
  };
}

function requireInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new ContractError('INVALID_INPUT', `${field} must be a non-negative integer`, {
      field,
      retryable: false,
    });
  return value as number;
}

function requireSourceRefs(value: unknown): Array<{ type: string; id: string }> {
  if (!Array.isArray(value))
    throw new ContractError('INVALID_INPUT', 'source_refs must be an array', {
      retryable: false,
    });
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      throw new ContractError('INVALID_INPUT', 'source_refs entries must be objects', {
        retryable: false,
      });
    const entry = item as Record<string, unknown>;
    return {
      type: requireString(entry.type, 'source_refs.type'),
      id: requireString(entry.id, 'source_refs.id'),
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const application = createPlatformServer({
    host: process.env.HOST ?? '0.0.0.0',
  });

  const shutdown = async (): Promise<void> => {
    await application.stop();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  void application.start().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
