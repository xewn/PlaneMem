import {
  ContractError,
  createUlid,
  type Classification,
  type ErrorEnvelope,
  type SourceRef,
  type Ulid,
} from '@planemem/contracts';

export interface ArtifactScope {
  tenant_id: Ulid;
  workspace_id: Ulid;
  project_id: Ulid;
}

export interface ArtifactMetadata extends ArtifactScope {
  schema_version: 1;
  artifact_id: Ulid;
  storage_key: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  classification: Classification;
  source_refs: SourceRef[];
  version: number;
  etag: string;
  trace_id: string;
}

export interface CreateArtifactInput extends ArtifactScope {
  name: string;
  mime: string;
  classification: Classification;
  source_refs: SourceRef[];
  trace_id: string;
}

export interface ArtifactVersionOptions {
  expected_version: number;
  expected_sha256?: string;
  idempotency_key?: string;
}

export type DownloadAuthorization =
  | { allowed: true; schema_version: 1; url: string; trace_id: string; audit_id: Ulid }
  | { allowed: false; error: ErrorEnvelope };

export class ArtifactService {
  private readonly artifacts = new Map<string, ArtifactMetadata>();
  private readonly contents = new Map<string, Uint8Array>();
  private readonly versions = new Map<string, Map<number, ArtifactMetadata>>();
  private readonly versionContents = new Map<string, Map<number, Uint8Array>>();
  private readonly idempotency = new Map<string, ArtifactMetadata>();

  health(): {
    service: 'artifact-service';
    version: '0.1.0';
    status: 'ok';
    ready: true;
    metrics: { artifacts: number; versions: number };
  } {
    return {
      service: 'artifact-service',
      version: '0.1.0',
      status: 'ok',
      ready: true,
      metrics: {
        artifacts: this.artifacts.size,
        versions: [...this.versions.values()].reduce((count, values) => count + values.size, 0),
      },
    };
  }

  async createArtifact(input: CreateArtifactInput): Promise<ArtifactMetadata> {
    const artifact_id = createUlid();
    const metadata: ArtifactMetadata = {
      ...input,
      schema_version: 1,
      artifact_id,
      storage_key: `artifacts/${input.tenant_id}/${input.project_id}/${artifact_id}`,
      size: 0,
      sha256: '',
      version: 1,
      etag: 'W/"version-1"',
    };
    this.artifacts.set(String(artifact_id), metadata);
    this.versions.set(String(artifact_id), new Map([[metadata.version, metadata]]));
    this.versionContents.set(String(artifact_id), new Map([[metadata.version, new Uint8Array()]]));
    return metadata;
  }

  async putVersion(
    artifact_id: Ulid,
    content: string | Uint8Array,
    options: ArtifactVersionOptions,
  ): Promise<ArtifactMetadata> {
    const metadata = this.getArtifact(artifact_id);
    if (options.idempotency_key !== undefined) {
      const previous = this.idempotency.get(options.idempotency_key);
      if (previous !== undefined) return previous;
    }
    if (metadata.version !== options.expected_version) {
      throw new ContractError('ARTIFACT_VERSION_CONFLICT', 'Artifact version does not match', {
        expected_version: options.expected_version,
        current_version: metadata.version,
        trace_id: metadata.trace_id,
        retryable: false,
      });
    }
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    const sha256 = await digest(bytes);
    if (options.expected_sha256 !== undefined && options.expected_sha256 !== sha256) {
      throw new ContractError('ARTIFACT_HASH_MISMATCH', 'Artifact content hash does not match', {
        expected_sha256: options.expected_sha256,
        actual_sha256: sha256,
        trace_id: metadata.trace_id,
        retryable: false,
      });
    }
    const updated = {
      ...metadata,
      size: bytes.byteLength,
      sha256,
      version: metadata.version + 1,
      etag: `W/"version-${metadata.version + 1}"`,
    };
    this.artifacts.set(String(artifact_id), updated);
    this.contents.set(String(artifact_id), bytes.slice());
    this.versions.get(String(artifact_id))?.set(updated.version, updated);
    this.versionContents.get(String(artifact_id))?.set(updated.version, bytes.slice());
    if (options.idempotency_key !== undefined)
      this.idempotency.set(options.idempotency_key, updated);
    return updated;
  }

  getVersion(artifact_id: Ulid, version: number): ArtifactMetadata {
    this.getArtifact(artifact_id);
    const result = this.versions.get(String(artifact_id))?.get(version);
    if (!result) {
      throw new ContractError('ARTIFACT_VERSION_NOT_FOUND', 'Artifact version does not exist', {
        artifact_id,
        version,
        trace_id: 'trace_artifact_version_unknown',
        retryable: false,
      });
    }
    return result;
  }

  readVersion(artifact_id: Ulid, version: number): Uint8Array {
    this.getVersion(artifact_id, version);
    return this.versionContents.get(String(artifact_id))?.get(version)?.slice() ?? new Uint8Array();
  }

  async restoreVersion(
    artifact_id: Ulid,
    source_version: number,
    options: ArtifactVersionOptions,
  ): Promise<ArtifactMetadata> {
    return this.putVersion(artifact_id, this.readVersion(artifact_id, source_version), options);
  }

  getArtifact(artifact_id: Ulid): ArtifactMetadata {
    const metadata = this.artifacts.get(String(artifact_id));
    if (!metadata) {
      throw new ContractError('ARTIFACT_NOT_FOUND', 'Artifact does not exist', {
        artifact_id,
        trace_id: 'trace_artifact_unknown',
        retryable: false,
      });
    }
    return metadata;
  }

  async verifyHash(artifact_id: Ulid, content: string | Uint8Array): Promise<boolean> {
    const metadata = this.getArtifact(artifact_id);
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    return metadata.sha256.length > 0 && metadata.sha256 === (await digest(bytes));
  }

  authorizeDownload(
    artifact_id: Ulid,
    request: ArtifactScope & { trace_id: string },
  ): DownloadAuthorization {
    const metadata = this.getArtifact(artifact_id);
    if (
      metadata.tenant_id !== request.tenant_id ||
      metadata.workspace_id !== request.workspace_id ||
      metadata.project_id !== request.project_id
    ) {
      return {
        allowed: false,
        error: new ContractError('ARTIFACT_ACCESS_DENIED', 'Artifact scope is not authorized', {
          artifact_id,
          trace_id: request.trace_id,
          retryable: false,
        }).envelope,
      };
    }
    return {
      allowed: true,
      schema_version: 1,
      url: `artifact://${metadata.storage_key}?version=${metadata.version}`,
      trace_id: request.trace_id,
      audit_id: createUlid(),
    };
  }
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource),
  );
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
