import { WORKBENCH_AUDIT_RESPONSE_BYTES, WORKBENCH_AUDIT_ERROR_BYTES } from '@planemem/contracts';
import { readWorkbenchJsonResponse } from './workbench-response';

/** Read the whole decoded JSON body within the same deadline used for its request. */
export async function readWorkbenchAuditResponse(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await readWorkbenchJsonResponse(
      response,
      signal,
      WORKBENCH_AUDIT_RESPONSE_BYTES,
      WORKBENCH_AUDIT_ERROR_BYTES,
    );
  } catch {
    void response.body?.cancel().catch(() => undefined);
    throw new TypeError('Audit response was incomplete, invalid or larger than its read limit.');
  }
}
