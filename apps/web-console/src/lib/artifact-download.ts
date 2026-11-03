import {
  isSyncIdentifier,
  isUlid,
  parseArtifactDownloadQuery,
  parseArtifactMetadataView,
  type ArtifactDownloadQuery,
  type ArtifactMetadataView,
} from '@planemem/contracts';
import { readArtifactTransferBytes } from './artifact-transfer';

export const WEB_ARTIFACT_DOWNLOAD_BYTES = 64 * 1024 * 1024;
export const WEB_ARTIFACT_QUERY_BYTES = 16 * 1024;
export interface ArtifactDownloadSelection {
  query: ArtifactDownloadQuery;
  scope: { tenant_id: string; workspace_id: string; project_id: string };
}

function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((field) => !allowed.includes(field))
  )
    throw new TypeError();
  return value as Record<string, unknown>;
}

export function parseArtifactDownloadSelection(value: unknown): ArtifactDownloadSelection {
  const row = record(value, ['query', 'scope']);
  const query = parseArtifactDownloadQuery(row.query);
  const scope = record(row.scope, ['tenant_id', 'workspace_id', 'project_id']);
  const { tenant_id, workspace_id, project_id } = scope;
  if (
    !isSyncIdentifier(tenant_id) ||
    !isSyncIdentifier(workspace_id) ||
    !isSyncIdentifier(project_id) ||
    [tenant_id, workspace_id, project_id].some((value) => value === '.' || value === '..')
  )
    throw new TypeError();
  return { query, scope: { tenant_id, workspace_id, project_id } };
}

export function artifactDownloadSelection(value: ArtifactMetadataView): ArtifactDownloadSelection {
  const artifact = parseArtifactMetadataView(value);
  return parseArtifactDownloadSelection({
    query: {
      artifact_id: artifact.artifact_id,
      version: artifact.version,
      sha256: artifact.sha256,
      size: artifact.size,
    },
    scope: {
      tenant_id: artifact.tenant_id,
      workspace_id: artifact.workspace_id,
      project_id: artifact.project_id,
    },
  });
}

export const artifactDownloadErrors = {
  signin: 'Sign in again, then explicitly request this same version.',
  denied: 'Your current session cannot download this version in the selected project.',
  invalid: 'The download could not be verified. No file has been prepared for saving.',
  unavailable: 'The file could not be downloaded. The selected version has been kept.',
  'too-large':
    'This file exceeds the download limit. Use the command-line or HTTP download with an appropriate limit.',
  busy: 'Download capacity is currently occupied. You can request this version again later.',
  legacy: 'A complete historical record is missing for this version.',
  canceled:
    'The download was canceled or timed out. A server release may already have been recorded.',
} as const;
export type ArtifactDownloadReason = keyof typeof artifactDownloadErrors;
export interface ArtifactDownloadFailure {
  schema_version: 1;
  trace_id: string;
  error: {
    reason: ArtifactDownloadReason;
    audit_state: 'not-requested' | 'unconfirmed' | 'release-recorded';
    audit_id?: string;
  };
}

export function parseArtifactDownloadFailure(
  value: unknown,
  trace: string,
): ArtifactDownloadFailure {
  const row = record(value, ['schema_version', 'trace_id', 'error']);
  const error = record(row.error, ['reason', 'audit_state', 'audit_id']);
  if (
    row.schema_version !== 1 ||
    row.trace_id !== trace ||
    !validDownloadTrace(trace) ||
    typeof error.reason !== 'string' ||
    !Object.hasOwn(artifactDownloadErrors, error.reason) ||
    typeof error.audit_state !== 'string' ||
    !['not-requested', 'unconfirmed', 'release-recorded'].includes(error.audit_state) ||
    (error.audit_state === 'release-recorded'
      ? !isUlid(error.audit_id)
      : error.audit_id !== undefined)
  )
    throw new TypeError();
  return {
    schema_version: 1,
    trace_id: trace,
    error: {
      reason: error.reason as ArtifactDownloadReason,
      audit_state: error.audit_state as ArtifactDownloadFailure['error']['audit_state'],
      ...(error.audit_id === undefined ? {} : { audit_id: error.audit_id as string }),
    },
  };
}

export function validDownloadTrace(value: string): boolean {
  return /^trace_web_download_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    value,
  );
}

/** Shared by the POST request reader, gateway proxy and browser; never returns partial content. */
export async function readArtifactDownloadBytes(
  body: ReadableStream<Uint8Array> | null,
  maximum: number,
  signal: AbortSignal,
  expected?: number,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 0 ||
    maximum > WEB_ARTIFACT_DOWNLOAD_BYTES ||
    (expected !== undefined &&
      (!Number.isSafeInteger(expected) || expected < 0 || expected > maximum))
  )
    throw new TypeError();
  return readArtifactTransferBytes(body, maximum, signal, expected);
}
