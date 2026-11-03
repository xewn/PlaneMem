export const WEB_ARTIFACT_UPLOAD_BYTES = 64 * 1024 * 1024;
export const WEB_ARTIFACT_UPLOAD_RESPONSE_BYTES = 2 * 1024 * 1024;
export const WEB_ARTIFACT_UPLOAD_ERROR_BYTES = 16 * 1024;

export const artifactUploadErrors = {
  signin: 'Sign in with the original account, client and project, then check the original receipt.',
  denied: 'This session cannot submit the original request in this project.',
  invalid: 'The request, file or returned result could not be verified. Keep the original request.',
  unavailable: 'The file service could not confirm this request. Keep the original JSON and file.',
  'too-large':
    'The file exceeds the upload limit. Keep the original request and use an appropriate upload client.',
  busy: 'Upload capacity is occupied. The original request has been kept.',
  mismatch:
    'This key belongs to different parameters. Recover the exact original request; do not generate a new key.',
  conflict:
    'The original version condition could not be accepted. Keep it unchanged and check the receipt.',
  canceled: 'The operation was stopped or timed out. A request already sent may still be saved.',
} as const;
export type ArtifactUploadReason = keyof typeof artifactUploadErrors;
export interface WebArtifactUploadFailure {
  schema_version: 1;
  trace_id: string;
  error: { reason: ArtifactUploadReason; dispatch_state: 'not-sent' | 'unconfirmed' };
}

export function validUploadTrace(value: string): boolean {
  return /^trace_web_upload_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    value,
  );
}

export function parseWebArtifactUploadFailure(
  value: unknown,
  trace: string,
): WebArtifactUploadFailure {
  const row = record(value, ['schema_version', 'trace_id', 'error']);
  const error = record(row.error, ['reason', 'dispatch_state']);
  if (
    row.schema_version !== 1 ||
    row.trace_id !== trace ||
    !validUploadTrace(trace) ||
    typeof error.reason !== 'string' ||
    !Object.hasOwn(artifactUploadErrors, error.reason) ||
    !['not-sent', 'unconfirmed'].includes(error.dispatch_state as string)
  )
    throw new TypeError('Invalid upload response');
  return {
    schema_version: 1,
    trace_id: trace,
    error: {
      reason: error.reason as ArtifactUploadReason,
      dispatch_state: error.dispatch_state as WebArtifactUploadFailure['error']['dispatch_state'],
    },
  };
}

function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new TypeError();
  return value as Record<string, unknown>;
}
