import { randomUUID } from 'node:crypto';
import {
  ContractError,
  CONTEXT_PACK_SAVE_RECEIPT_RESPONSE_BYTES,
  contextPackSaveReceiptQuery,
  packGateway,
  parsePackSaveOriginal,
  parseContextPackSaveReceiptEnvelope,
  syncJsonSnapshot,
  validateErrorEnvelope,
} from '@planemem/contracts';
import { decodeJwtClaims, getSession } from './auth';
import { runtimeConfig } from './config';
import { readWorkbenchJsonResponse } from './workbench-response';

const messages: Record<string, string> = {
  INVALID_INPUT: 'Keep the complete original request and its unchanged settings.',
  UNAUTHENTICATED: 'Sign in as the original requester before querying again.',
  DENIED: 'Restore the original gateway, project, account, client and permissions.',
  CONTEXT_PACK_NOT_FOUND: 'The original project is not currently available to this reader.',
  IDEMPOTENCY_KEY_REUSED: 'This key belongs to different settings. Keep the exact original.',
  CONTEXT_PACK_RECEIPT_INVALID: 'The historical save metadata could not be validated.',
  CONTEXT_PACK_STORAGE_UNAVAILABLE: 'Historical save storage is unavailable.',
  CONTEXT_PACK_RECEIPT_TIMEOUT: 'The gateway stopped waiting for the historical lookup.',
  WORKBENCH_AUTH_UNAVAILABLE: 'Authentication is temporarily unavailable.',
  AUDIT_PERSISTENCE_UNAVAILABLE: 'The query audit could not be confirmed.',
  RATE_LIMITED: 'Historical save lookups are busy. Keep the original and query again later.',
  GATEWAY_REQUEST_TIMEOUT: 'Stopped waiting for the lookup. Keep the original request.',
  GATEWAY_RESPONSE_INVALID: 'The complete historical lookup response could not be verified.',
  GATEWAY_UNAVAILABLE: 'The historical save lookup could not be completed.',
};
const errorStatuses: Record<string, number> = {
  INVALID_INPUT: 400,
  DENIED: 403,
  CONTEXT_PACK_NOT_FOUND: 404,
  IDEMPOTENCY_KEY_REUSED: 409,
  CONTEXT_PACK_RECEIPT_INVALID: 500,
  CONTEXT_PACK_STORAGE_UNAVAILABLE: 503,
  CONTEXT_PACK_RECEIPT_TIMEOUT: 503,
  WORKBENCH_AUTH_UNAVAILABLE: 503,
  AUDIT_PERSISTENCE_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
};
export class ContextPackSaveReceiptError extends ContractError {
  constructor(code: string, trace: string) {
    super(code, messages[code]!, { trace_id: trace, retryable: false });
  }
}

let activeReads = 0;
/** A single read-only lookup; the original never supplies a replacement network destination. */
export async function readWorkbenchContextPackSaveReceipt(input: unknown) {
  const trace = 'trace_web_pack_receipt_' + randomUUID();
  const fail = (code: string) => new ContextPackSaveReceiptError(code, trace);
  let original: ReturnType<typeof parsePackSaveOriginal>;
  try {
    original = parsePackSaveOriginal(input);
  } catch {
    throw fail('INVALID_INPUT');
  }
  const query = contextPackSaveReceiptQuery(original);
  if (activeReads >= 2) throw fail('RATE_LIMITED');
  activeReads++;
  const controller = new AbortController();
  const deadline = performance.now() + 30_000;
  let expiry = Infinity;
  const active = () => {
    if (controller.signal.aborted || performance.now() >= deadline)
      throw fail('GATEWAY_REQUEST_TIMEOUT');
    if (expiry <= Date.now()) throw fail('UNAUTHENTICATED');
  };
  let response: Response | undefined;
  const work = (async () => {
    try {
      active();
      const session = await getSession();
      active();
      if (
        !session ||
        !session.access_token.trim() ||
        !Number.isSafeInteger(session.expires_at) ||
        session.expires_at * 1000 <= Date.now()
      )
        throw fail('UNAUTHENTICATED');
      const token = session.access_token;
      expiry = session.expires_at * 1000;
      const claims = decodeJwtClaims(token);
      const scope = {
        tenant_id: claims.tenant_id ?? session.tenant_id ?? runtimeConfig.tenantId,
        workspace_id: claims.workspace_id ?? session.workspace_id ?? runtimeConfig.workspaceId,
        project_id: claims.project_id ?? session.project_id ?? runtimeConfig.projectId,
      };
      let base: string;
      try {
        base = packGateway(runtimeConfig.apiUrl);
        new Headers({ authorization: 'Bearer ' + token });
      } catch {
        throw fail('INVALID_INPUT');
      }
      if (
        base !== original.binding.gateway_url ||
        (['tenant_id', 'workspace_id', 'project_id'] as const).some(
          (key) => scope[key] !== query.identity[key],
        )
      )
        throw fail('DENIED');
      active();
      response = await fetch(base + '/v1/context-pack/save-receipt', {
        method: 'POST',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          authorization: 'Bearer ' + token,
          accept: 'application/json',
          'content-type': 'application/json',
          'x-trace-id': trace,
          'x-tenant-id': query.identity.tenant_id,
          'x-workspace-id': query.identity.workspace_id,
          'x-project-id': query.identity.project_id,
          'x-expected-actor-id': query.identity.actor_id,
          'x-expected-client-id': query.identity.client_id,
        },
        body: JSON.stringify(query),
      });
      active();
      // Authentication may reject before the normal business response is constructed.
      if (response.status === 401) throw fail('UNAUTHENTICATED');
      if (
        (response.status !== 200 && (response.status < 400 || response.status > 599)) ||
        response.headers.get('x-trace-id') !== trace ||
        response.headers.has('etag')
      )
        throw fail('GATEWAY_RESPONSE_INVALID');
      const raw = await readWorkbenchJsonResponse(
        response,
        controller.signal,
        CONTEXT_PACK_SAVE_RECEIPT_RESPONSE_BYTES,
        CONTEXT_PACK_SAVE_RECEIPT_RESPONSE_BYTES,
      );
      active();
      if (!response.ok) {
        const value: unknown = JSON.parse(
          syncJsonSnapshot(raw, CONTEXT_PACK_SAVE_RECEIPT_RESPONSE_BYTES),
        );
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          Object.keys(value).some(
            (key) => !['code', 'message', 'details', 'trace_id', 'retryable'].includes(key),
          )
        )
          throw fail('GATEWAY_RESPONSE_INVALID');
        const error = validateErrorEnvelope(value);
        if (
          error.trace_id !== trace ||
          !Object.hasOwn(errorStatuses, error.code) ||
          errorStatuses[error.code] !== response.status
        )
          throw fail('GATEWAY_RESPONSE_INVALID');
        throw fail(error.code);
      }
      const result = parseContextPackSaveReceiptEnvelope(raw, query, trace);
      active();
      return result;
    } catch (error) {
      void response?.body?.cancel().catch(() => undefined);
      active();
      if (error instanceof ContextPackSaveReceiptError) throw error;
      throw fail(response ? 'GATEWAY_RESPONSE_INVALID' : 'GATEWAY_UNAVAILABLE');
    } finally {
      // A local timeout must not free a slot while session/HTTP work is still pending.
      activeReads--;
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => {
            controller.abort();
            reject(fail('GATEWAY_REQUEST_TIMEOUT'));
          },
          Math.max(1, deadline - performance.now()),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
