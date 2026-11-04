import { ContractError, validateErrorEnvelope } from '@planemem/contracts';
import { readWorkbenchJsonResponse } from './workbench-response';

export type ArtifactLookupKind = 'current' | 'historical' | 'receipt';

const messages: Record<string, string> = {
  INVALID_INPUT: 'Choose valid file details or the complete saved original request.',
  DENIED: 'Your current session cannot read this file information.',
  ARTIFACT_ACCESS_DENIED: 'Your account or client cannot read this file information.',
  ARTIFACT_NOT_FOUND: 'This file is unavailable in the selected project.',
  ARTIFACT_VERSION_NOT_FOUND: 'This saved file version is unavailable.',
  ARTIFACT_VERSION_CONFLICT: 'The original file version could not be matched.',
  ARTIFACT_LEGACY_UNVERIFIED: 'A complete trusted saved version record is missing.',
  ARTIFACT_STORED_INVALID: 'The saved file information could not be validated.',
  ARTIFACT_STORAGE_UNAVAILABLE: 'File information is temporarily unavailable.',
  IDEMPOTENCY_KEY_REUSED: 'The saved request key does not match the recorded parameters.',
  RATE_LIMITED: 'File information reads are temporarily busy.',
  WORKBENCH_AUTH_UNAVAILABLE: 'Gateway authentication is temporarily unavailable.',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The file read audit could not be persisted.',
  GATEWAY_RESPONSE_INVALID:
    'The complete file response was invalid, incomplete or exceeded its read limit.',
  GATEWAY_REQUEST_TIMEOUT: 'File information exceeded the local read deadline.',
  GATEWAY_UNAVAILABLE: 'File information could not be read.',
};

export function artifactLookupFailure(kind: ArtifactLookupKind, code: string, trace: string) {
  const known = Object.hasOwn(messages, code) ? code : 'GATEWAY_UNAVAILABLE';
  return new ContractError(
    known,
    messages[known]! +
      (kind === 'receipt'
        ? ' Keep the saved original request. This read does not establish that its upload failed.'
        : ''),
    { trace_id: trace, retryable: false },
  );
}

/** Bound the entire lookup response before the caller's complete contract parser runs. */
export async function readArtifactLookupResponse<T>(
  response: Response,
  signal: AbortSignal,
  trace: string,
  deadline: number,
  kind: ArtifactLookupKind,
  parse: (value: unknown) => T,
): Promise<T> {
  const fail = (code: string) => artifactLookupFailure(kind, code, trace);
  const check = () => {
    if (signal.aborted || Date.now() >= deadline) throw fail('GATEWAY_REQUEST_TIMEOUT');
  };
  let value: unknown;
  try {
    check();
    if (response.headers.get('x-trace-id') !== trace) throw new TypeError();
    if ((!response.ok || kind !== 'current') && response.headers.has('etag')) throw new TypeError();
    value = await readWorkbenchJsonResponse(
      response,
      signal,
      (kind === 'receipt' ? 4 : 2) * 1024 * 1024,
      16 * 1024,
    );
  } catch {
    void response.body?.cancel().catch(() => undefined);
    check();
    throw fail('GATEWAY_RESPONSE_INVALID');
  }
  check();
  if (!response.ok) {
    let code: string;
    try {
      const error = validateErrorEnvelope(value);
      if (error.trace_id !== trace) throw new TypeError();
      code = error.code;
    } catch {
      check();
      throw fail('GATEWAY_RESPONSE_INVALID');
    }
    check();
    throw fail(code);
  }
  let result: T;
  try {
    result = parse(value);
    if (kind === 'current') {
      const etag = (value as { etag?: unknown } | null)?.etag;
      if (typeof etag !== 'string' || response.headers.get('etag') !== etag) throw new TypeError();
    }
  } catch {
    check();
    throw fail('GATEWAY_RESPONSE_INVALID');
  }
  check();
  return result;
}
