import {
  buildEtag,
  ContractError,
  createUlid,
  isUlid,
  parseArtifactVersionsQuery,
  parseArtifactVersionsPage,
  summarizeArtifactVersion,
  syncJsonSnapshot,
  type ArtifactVersionsQuery,
  type ArtifactVersionsPage,
} from '@planemem/contracts';
import {
  artifactCommandHash,
  artifactDigest,
  artifactObjectKey,
  artifactReceiptId,
  parseArtifactAccess,
  parseArtifactWrite,
  parsePersistentArtifact,
  timestamp,
  type ArtifactAccess,
  type ArtifactCreateCommand,
  type ArtifactPutCommand,
  type ArtifactWriteCommand,
  type ArtifactWriteResult,
  type ArtifactReceiptResult,
  type ArtifactDatabase,
  type ArtifactSqlTransaction,
  type ImmutableArtifactObjects,
  type PersistentArtifactMetadata,
} from './persistent-model.js';

type Row = Record<string, unknown>;

/** Durable implementation. The existing ArtifactService remains an offline compatibility fixture. */
export class PersistentArtifactService {
  constructor(
    private readonly database: ArtifactDatabase,
    private readonly objects: ImmutableArtifactObjects,
    private readonly maxBytes = 64 * 1024 * 1024,
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
      throw new TypeError('Invalid artifact size limit');
  }

  createArtifact(access: ArtifactAccess, command: ArtifactCreateCommand, content: Uint8Array) {
    return this.write(access, command, content, 'artifact.create');
  }
  putVersion(access: ArtifactAccess, command: ArtifactPutCommand, content: Uint8Array) {
    return this.write(access, command, content, 'artifact.put-version');
  }

  async getArtifact(
    rawAccess: ArtifactAccess,
    artifactId: string,
  ): Promise<PersistentArtifactMetadata> {
    const access = this.access(rawAccess, 'artifact.read');
    this.target(artifactId, access);
    return this.storage(access, () =>
      this.database.transaction(async (tx) => {
        await this.project(tx, access);
        return this.current(tx, access, artifactId);
      }),
    );
  }

  async getVersion(
    rawAccess: ArtifactAccess,
    artifactId: string,
    version: number,
  ): Promise<PersistentArtifactMetadata> {
    const access = this.access(rawAccess, 'artifact.read');
    this.target(artifactId, access);
    if (!Number.isSafeInteger(version) || version < 1)
      throw this.error('INVALID_INPUT', 'Supply a positive artifact version', access);
    return this.storage(access, () =>
      this.database.transaction(async (tx) => {
        await this.project(tx, access);
        const current = await this.current(tx, access, artifactId);
        return this.version(tx, access, current, version);
      }),
    );
  }

  async listVersions(
    rawAccess: ArtifactAccess,
    input: ArtifactVersionsQuery,
  ): Promise<ArtifactVersionsPage> {
    const access = this.access(rawAccess, 'artifact.read');
    let query;
    try {
      query = parseArtifactVersionsQuery(input);
    } catch {
      throw this.error(
        'INVALID_INPUT',
        'Supply an artifact and a bounded version page query',
        access,
      );
    }
    return this.storage(access, () =>
      this.database.transaction(async (tx) => {
        // Share locks keep the parent and current artifact visible throughout this page read.
        await this.project(tx, access);
        const current = await this.current(tx, access, query.artifact_id);
        const ceiling = query.at_version ?? current.version;
        if (ceiling > current.version)
          throw this.error(
            'INVALID_INPUT',
            'Version ceiling exceeds the current artifact version',
            access,
          );
        const maximum = 2 * 1024 * 1024;
        const rows = await tx.query<Row>(
          `SELECT version, storage_key, sha256, size_bytes, trace_id, created_at,
          octet_length(metadata_snapshot::text) AS snapshot_bytes,
          CASE WHEN octet_length(metadata_snapshot::text) <= $5 THEN metadata_snapshot ELSE NULL END AS metadata_snapshot
        FROM wcp_artifact_versions
        WHERE artifact_id=$1 AND version <= $2 AND ($3::bigint IS NULL OR version < $3)
        ORDER BY version DESC LIMIT $4`,
          [query.artifact_id, ceiling, query.before_version ?? null, query.limit + 1, maximum],
        );
        try {
          if (rows.length > query.limit + 1) throw new TypeError();
          let previous = query.before_version;
          // Validate the lookahead too; never hide an inaccessible or invalid row behind has_more.
          const summaries = rows.map((row) => {
            if (
              row.snapshot_bytes !== null &&
              row.snapshot_bytes !== undefined &&
              (!Number.isSafeInteger(this.number(row.snapshot_bytes)) ||
                this.number(row.snapshot_bytes) < 1 ||
                this.number(row.snapshot_bytes) > maximum)
            )
              throw new TypeError();
            const version = this.number(row.version);
            if (
              !Number.isSafeInteger(version) ||
              version < 1 ||
              version > ceiling ||
              (previous !== undefined && version >= previous)
            )
              throw new TypeError();
            previous = version;
            // Also detach and bound custom adapter snapshots before interpreting their fields.
            const bounded =
              row.metadata_snapshot == null
                ? row
                : {
                    ...row,
                    metadata_snapshot: JSON.parse(
                      syncJsonSnapshot(this.json(row.metadata_snapshot), maximum),
                    ),
                  };
            const saved = this.versionRow(bounded, access, current, version);
            return summarizeArtifactVersion(saved);
          });
          const items = summaries.slice(0, query.limit);
          const more = summaries.length > query.limit;
          return parseArtifactVersionsPage(
            {
              tenant_id: access.tenant_id,
              workspace_id: access.workspace_id,
              project_id: access.project_id,
              query,
              snapshot_version: ceiling,
              items,
              has_more: more,
              next_query: more
                ? {
                    artifact_id: query.artifact_id,
                    limit: query.limit,
                    at_version: ceiling,
                    before_version: items[items.length - 1]!.version,
                  }
                : null,
              content_state: 'not-checked',
            },
            query,
            access,
          );
        } catch (error) {
          if (error instanceof ContractError) throw error;
          throw this.invalidStored(access);
        }
      }),
    );
  }

  async readVersion(rawAccess: ArtifactAccess, artifactId: string, version: number) {
    const access = this.access(rawAccess, 'artifact.read');
    const metadata = await this.getVersion(access, artifactId, version);
    const bytes = await this.readObject(metadata, access);
    return { artifact: metadata, content: bytes, trace_id: access.trace_id };
  }

  async restoreVersion(
    rawAccess: ArtifactAccess,
    command: ArtifactPutCommand,
    sourceVersion: number,
  ) {
    const access = this.access(rawAccess, 'artifact.write');
    const original = this.command(command, access);
    if (original.operation !== 'artifact.put-version')
      throw this.error('INVALID_INPUT', 'Restore requires a version request', access);
    const source = await this.readVersion(access, original.artifact_id, sourceVersion);
    if (source.artifact.sha256 !== original.sha256 || source.artifact.size !== original.size)
      throw this.error(
        'ARTIFACT_HASH_MISMATCH',
        'The selected historical version differs from the original content descriptor',
        access,
      );
    // Restoration appends content to a new version; historical metadata is never rewritten.
    return this.putVersion(access, original, source.content);
  }

  async getCommandReceipt(
    rawAccess: ArtifactAccess,
    rawCommand: ArtifactWriteCommand,
  ): Promise<ArtifactReceiptResult> {
    const access = this.access(rawAccess, 'artifact.write');
    const command = this.command(rawCommand, access);
    return this.storage<ArtifactReceiptResult>(access, () =>
      this.database.transaction<ArtifactReceiptResult>(async (tx) => {
        await this.project(tx, access);
        const previous = await this.receipt(tx, access, command);
        // A missing receipt must not turn an inaccessible existing target into an absence result.
        if (!previous && command.operation === 'artifact.put-version')
          await this.current(tx, access, command.artifact_id);
        return previous ?? { status: 'not-observed', trace_id: access.trace_id };
      }),
    );
  }

  private async write(
    rawAccess: ArtifactAccess,
    rawCommand: ArtifactWriteCommand,
    content: Uint8Array,
    operation: ArtifactWriteCommand['operation'],
  ): Promise<ArtifactWriteResult> {
    const access = this.access(rawAccess, 'artifact.write');
    const command = this.command(rawCommand, access);
    if (command.operation !== operation)
      throw this.error('INVALID_INPUT', 'Artifact operation differs', access);
    if (
      !(content instanceof Uint8Array) ||
      content.byteLength > this.maxBytes ||
      content.byteLength !== command.size
    )
      throw this.error(
        'INVALID_INPUT',
        'Artifact content length is invalid or exceeds the configured limit',
        access,
      );
    // Freeze mutable caller data before any asynchronous database or object operation.
    const bytes = new Uint8Array(content);
    if (artifactDigest(bytes) !== command.sha256)
      throw this.error(
        'ARTIFACT_HASH_MISMATCH',
        'Artifact content differs from its original SHA-256',
        access,
      );
    if (command.operation === 'artifact.create')
      this.classification(access, command.classification);
    return this.storage<ArtifactWriteResult>(access, () =>
      this.database.transaction<ArtifactWriteResult>(async (tx) => {
        await this.project(tx, access);
        const receiptId = artifactReceiptId(access, command.request_key);
        // Serializes the original identity/key, including concurrent creates of different artifacts.
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [receiptId]);
        const previous = await this.receipt(tx, access, command);
        if (previous) return previous;
        const current =
          command.operation === 'artifact.put-version'
            ? await this.current(tx, access, command.artifact_id, true)
            : undefined;
        if (
          current &&
          command.operation === 'artifact.put-version' &&
          current.version !== command.expected_version
        )
          throw this.error(
            'ARTIFACT_VERSION_CONFLICT',
            'Artifact changed; retain the original request and check its receipt',
            access,
          );
        const [clock] = await tx.query<Row>('SELECT clock_timestamp() AS now', []);
        let now: string;
        try {
          now = timestamp(clock?.now);
        } catch {
          throw this.invalidStored(access);
        }
        const artifactId = current?.artifact_id ?? createUlid();
        const nextVersion = current ? current.version + 1 : 1;
        const source = command.operation === 'artifact.create' ? command : current!;
        const metadata = parsePersistentArtifact({
          schema_version: 1,
          tenant_id: access.tenant_id,
          workspace_id: access.workspace_id,
          project_id: access.project_id,
          artifact_id: artifactId,
          name: source.name,
          mime: source.mime,
          classification: source.classification,
          source_refs: source.source_refs,
          sha256: command.sha256,
          size: command.size,
          storage_key: artifactObjectKey({ ...access, artifact_id: artifactId }, command.sha256),
          version: nextVersion,
          etag: buildEtag(nextVersion),
          trace_id: access.trace_id,
          created_at: current?.created_at ?? now,
          updated_at: now,
        });
        // The object may survive a later rollback. Never delete it or replace it on an uncertain result.
        try {
          await this.objects.putIfAbsent(metadata.storage_key, bytes);
        } catch {
          throw this.error(
            'ARTIFACT_OBJECT_UNAVAILABLE',
            'Object storage did not confirm the immutable upload',
            access,
            true,
          );
        }
        await this.readObject(metadata, access);
        if (!current) {
          await tx.query(
            `INSERT INTO wcp_artifacts
          (artifact_id, tenant_id, workspace_id, project_id, storage_key, name, mime, size_bytes, sha256,
           classification, source_refs, version, etag, trace_id, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16)`,
            [
              artifactId,
              access.tenant_id,
              access.workspace_id,
              access.project_id,
              metadata.storage_key,
              metadata.name,
              metadata.mime,
              metadata.size,
              metadata.sha256,
              metadata.classification,
              JSON.stringify(metadata.source_refs),
              nextVersion,
              metadata.etag,
              metadata.trace_id,
              metadata.created_at,
              now,
            ],
          );
        } else {
          const updated = await tx.query<Row>(
            `UPDATE wcp_artifacts SET storage_key=$5, size_bytes=$6, sha256=$7,
          version=$8, etag=$9, trace_id=$10, updated_at=$11
          WHERE artifact_id=$1 AND tenant_id=$2 AND workspace_id=$3 AND project_id=$4 AND version=$12
          RETURNING artifact_id`,
            [
              artifactId,
              access.tenant_id,
              access.workspace_id,
              access.project_id,
              metadata.storage_key,
              metadata.size,
              metadata.sha256,
              nextVersion,
              metadata.etag,
              metadata.trace_id,
              now,
              current.version,
            ],
          );
          if (updated.length !== 1)
            throw this.error('ARTIFACT_VERSION_CONFLICT', 'Artifact version changed', access);
        }
        await tx.query(
          `INSERT INTO wcp_artifact_versions
        (artifact_id, version, sha256, size_bytes, storage_key, trace_id, created_at, metadata_snapshot)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [
            artifactId,
            nextVersion,
            metadata.sha256,
            metadata.size,
            metadata.storage_key,
            metadata.trace_id,
            now,
            JSON.stringify(metadata),
          ],
        );
        await tx.query(
          `INSERT INTO wcp_artifact_command_receipts
        (receipt_id, tenant_id, workspace_id, project_id, actor_id, client_id, request_key, operation,
         command_hash, command, artifact_id, artifact_version, result, trace_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb,$14)`,
          [
            receiptId,
            access.tenant_id,
            access.workspace_id,
            access.project_id,
            access.actor_id,
            access.client_id,
            command.request_key,
            command.operation,
            artifactCommandHash(command),
            JSON.stringify(command),
            artifactId,
            nextVersion,
            JSON.stringify(metadata),
            access.trace_id,
          ],
        );
        return {
          status: 'recorded',
          artifact: metadata,
          replayed: false,
          trace_id: access.trace_id,
        };
      }),
    );
  }

  private async project(tx: ArtifactSqlTransaction, access: ArtifactAccess) {
    const rows = await tx.query<Row>(
      `SELECT id FROM wcp_projects
      WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3 AND deleted_at IS NULL
        AND classification IN ('public','internal','confidential'${this.restricted(access) ? ",'restricted'" : ''}) FOR SHARE`,
      [access.tenant_id, access.workspace_id, access.project_id],
    );
    if (rows.length !== 1)
      throw this.error('ARTIFACT_NOT_FOUND', 'Artifact project is unavailable', access);
  }

  private async current(
    tx: ArtifactSqlTransaction,
    access: ArtifactAccess,
    artifactId: string,
    writing = false,
  ) {
    const rows = await tx.query<Row>(
      `SELECT a.*, v.metadata_snapshot,
        v.storage_key AS saved_key, v.sha256 AS saved_hash, v.size_bytes AS saved_size,
        v.trace_id AS saved_trace, v.created_at AS saved_at
      FROM wcp_artifacts a LEFT JOIN wcp_artifact_versions v ON v.artifact_id=a.artifact_id AND v.version=a.version
      WHERE a.tenant_id=$1 AND a.workspace_id=$2 AND a.project_id=$3 AND a.artifact_id=$4 AND a.deleted_at IS NULL
        AND a.classification IN ('public','internal','confidential'${this.restricted(access) ? ",'restricted'" : ''})
      FOR ${writing ? 'UPDATE' : 'SHARE'} OF a`,
      [access.tenant_id, access.workspace_id, access.project_id, artifactId],
    );
    const row = rows[0];
    if (!row)
      throw this.error('ARTIFACT_NOT_FOUND', 'Artifact is unavailable in this project', access);
    if (row.metadata_snapshot == null)
      throw this.error(
        'ARTIFACT_LEGACY_UNVERIFIED',
        'This artifact has no verified persistent version snapshot',
        access,
      );
    try {
      if (rows.length !== 1) throw new TypeError();
      const result = parsePersistentArtifact({
        ...row,
        schema_version: 1,
        size: this.number(row.size_bytes),
        version: this.number(row.version),
        source_refs: this.json(row.source_refs),
      });
      const saved = parsePersistentArtifact(this.json(row.metadata_snapshot));
      if (
        JSON.stringify(saved) !== JSON.stringify(result) ||
        row.saved_key !== result.storage_key ||
        row.saved_hash !== result.sha256 ||
        this.number(row.saved_size) !== result.size ||
        row.saved_trace !== result.trace_id ||
        timestamp(row.saved_at) !== result.updated_at
      )
        throw new TypeError();
      this.scope(result, access, artifactId);
      return result;
    } catch {
      throw this.invalidStored(access);
    }
  }

  private async version(
    tx: ArtifactSqlTransaction,
    access: ArtifactAccess,
    current: PersistentArtifactMetadata,
    version: number,
  ) {
    const rows = await tx.query<Row>(
      `SELECT version, storage_key, sha256, size_bytes, trace_id, created_at, metadata_snapshot
      FROM wcp_artifact_versions WHERE artifact_id=$1 AND version=$2`,
      [current.artifact_id, version],
    );
    const row = rows[0];
    if (!row)
      throw this.error('ARTIFACT_VERSION_NOT_FOUND', 'Artifact version is unavailable', access);
    if (rows.length !== 1) throw this.invalidStored(access);
    return this.versionRow(row, access, current, version);
  }

  private versionRow(
    row: Row,
    access: ArtifactAccess,
    current: PersistentArtifactMetadata,
    version: number,
  ) {
    if (row.metadata_snapshot == null)
      throw this.error(
        'ARTIFACT_LEGACY_UNVERIFIED',
        'Historical metadata was not recorded for this version',
        access,
      );
    let result;
    try {
      result = parsePersistentArtifact(this.json(row.metadata_snapshot));
      this.scope(result, access, current.artifact_id);
      if (
        result.version !== version ||
        version > current.version ||
        this.number(row.version) !== version ||
        row.storage_key !== result.storage_key ||
        row.sha256 !== result.sha256 ||
        this.number(row.size_bytes) !== result.size ||
        row.trace_id !== result.trace_id ||
        result.created_at !== current.created_at ||
        timestamp(row.created_at) !== result.updated_at
      )
        throw new TypeError();
    } catch {
      throw this.invalidStored(access);
    }
    this.classification(access, result.classification);
    return result;
  }

  private async receipt(
    tx: ArtifactSqlTransaction,
    access: ArtifactAccess,
    command: ArtifactWriteCommand,
  ): Promise<ArtifactWriteResult | undefined> {
    const rows = await tx.query<Row>(
      'SELECT * FROM wcp_artifact_command_receipts WHERE receipt_id=$1',
      [artifactReceiptId(access, command.request_key)],
    );
    const row = rows[0];
    if (!row) return;
    let result: PersistentArtifactMetadata;
    try {
      if (
        rows.length !== 1 ||
        ['tenant_id', 'workspace_id', 'project_id', 'actor_id', 'client_id'].some(
          (field) => row[field] !== access[field as keyof ArtifactAccess],
        ) ||
        row.request_key !== command.request_key
      )
        throw new TypeError();
      const storedCommand = parseArtifactWrite(this.json(row.command));
      if (
        row.command_hash !== artifactCommandHash(storedCommand) ||
        row.operation !== storedCommand.operation ||
        storedCommand.request_key !== row.request_key
      )
        throw new TypeError();
      if (row.command_hash !== artifactCommandHash(command))
        throw this.error(
          'IDEMPOTENCY_KEY_REUSED',
          'Original artifact request key belongs to different parameters',
          access,
        );
      result = parsePersistentArtifact(this.json(row.result));
      this.scope(result, access, String(row.artifact_id));
      if (
        this.number(row.artifact_version) !== result.version ||
        row.trace_id !== result.trace_id ||
        result.sha256 !== command.sha256 ||
        result.size !== command.size
      )
        throw new TypeError();
      if (command.operation === 'artifact.create') {
        if (
          result.version !== 1 ||
          result.name !== command.name ||
          result.mime !== command.mime ||
          result.classification !== command.classification ||
          JSON.stringify(result.source_refs) !== JSON.stringify(command.source_refs)
        )
          throw new TypeError();
      } else if (
        result.artifact_id !== command.artifact_id ||
        result.version !== command.expected_version + 1
      )
        throw new TypeError();
    } catch (error) {
      if (error instanceof ContractError && error.envelope.code === 'IDEMPOTENCY_KEY_REUSED')
        throw error;
      throw this.invalidStored(access);
    }
    const current = await this.current(tx, access, result.artifact_id);
    const saved = await this.version(tx, access, current, result.version);
    if (JSON.stringify(saved) !== JSON.stringify(result)) throw this.invalidStored(access);
    return { status: 'recorded', artifact: result, replayed: true, trace_id: access.trace_id };
  }

  private async readObject(metadata: PersistentArtifactMetadata, access: ArtifactAccess) {
    if (metadata.size > this.maxBytes)
      throw this.error('ARTIFACT_TOO_LARGE', 'Artifact exceeds this reader size limit', access);
    let bytes;
    try {
      bytes = await this.objects.read(metadata.storage_key, metadata.size);
    } catch {
      throw this.error(
        'ARTIFACT_OBJECT_UNAVAILABLE',
        'Artifact object could not be read',
        access,
        true,
      );
    }
    if (bytes === undefined)
      throw this.error('ARTIFACT_OBJECT_MISSING', 'Referenced artifact object is missing', access);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== metadata.size)
      throw this.error(
        'ARTIFACT_HASH_MISMATCH',
        'Object storage returned invalid bytes or length',
        access,
      );
    const copy = new Uint8Array(bytes);
    if (copy.byteLength !== metadata.size || artifactDigest(copy) !== metadata.sha256)
      throw this.error(
        'ARTIFACT_HASH_MISMATCH',
        'Stored artifact bytes do not match their recorded size and SHA-256',
        access,
      );
    return copy;
  }
  private access(raw: ArtifactAccess, capability: string) {
    let access;
    try {
      access = parseArtifactAccess(raw);
    } catch {
      throw new ContractError('INVALID_INPUT', 'Supply verified artifact access context');
    }
    if (!access.capabilities.includes(capability))
      throw this.error('ARTIFACT_ACCESS_DENIED', 'Artifact capability is required', access);
    return access;
  }
  private command(raw: ArtifactWriteCommand, access: ArtifactAccess) {
    try {
      return parseArtifactWrite(raw);
    } catch {
      throw this.error('INVALID_INPUT', 'Invalid original artifact request', access);
    }
  }
  private restricted(access: ArtifactAccess) {
    return access.capabilities.includes('data.restricted.read');
  }
  private classification(access: ArtifactAccess, value: string) {
    if (value === 'restricted' && !this.restricted(access))
      throw this.error('ARTIFACT_ACCESS_DENIED', 'Restricted artifact access is required', access);
  }
  private target(id: string, access: ArtifactAccess) {
    if (!isUlid(id)) throw this.error('INVALID_INPUT', 'Supply an artifact ULID', access);
  }
  private scope(metadata: PersistentArtifactMetadata, access: ArtifactAccess, id: string) {
    if (
      metadata.artifact_id !== id ||
      metadata.tenant_id !== access.tenant_id ||
      metadata.workspace_id !== access.workspace_id ||
      metadata.project_id !== access.project_id
    )
      throw new TypeError('Artifact scope differs');
  }
  private number(value: unknown) {
    return typeof value === 'number'
      ? value
      : typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
        ? Number(value)
        : NaN;
  }
  private json(value: unknown): unknown {
    return typeof value === 'string' ? JSON.parse(value) : value;
  }
  private error(code: string, message: string, access: ArtifactAccess, retryable = false) {
    return new ContractError(code, message, { trace_id: access.trace_id, retryable });
  }
  private invalidStored(access: ArtifactAccess) {
    return this.error(
      'ARTIFACT_STORED_INVALID',
      'Stored artifact metadata or original receipt is inconsistent',
      access,
    );
  }
  private async storage<T>(access: ArtifactAccess, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ContractError) throw error;
      throw this.error(
        'ARTIFACT_STORAGE_UNAVAILABLE',
        'Artifact storage did not confirm the operation. Keep the original request and query its receipt before retrying.',
        access,
        true,
      );
    }
  }
}
