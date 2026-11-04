import { createHash, randomUUID } from 'node:crypto';
import {
  ContractError,
  CONTEXT_PACK_READ_RESPONSE_BYTES,
  CONTEXT_PACK_READ_ERROR_BYTES,
  CONTEXT_PACK_SAVE_CONTEXT_BYTES,
  contextPackReadHashJson,
  isSyncIdentifier,
  isUlid,
  parseContextPackCompileEnvelope,
  parseContextPackCompileParameters,
  parseContextPackSaveContextEnvelope,
  syncJsonSnapshot,
  validateErrorEnvelope,
  validateIdempotencyKey,
} from '@planemem/contracts';
import { decodeJwtClaims, getSession } from './auth';
import { runtimeConfig } from './config';
import { readWorkbenchJsonResponse } from './workbench-response';
import {
  assertPackSaveBinding,
  packGateway,
  parsePackSaveBinding,
  type PackSaveBinding,
} from '../app/context/save-model';

const messages: Record<string, string> = {
  INVALID_INPUT:
    'Keep a valid original request key, budget of 128–32768 and lifetime of 60–86400 seconds.',
  UNAUTHENTICATED:
    'Sign in with the original account and project before retrying the same request.',
  DENIED: 'The current account or client cannot save this pack. Keep the original request.',
  CONTEXT_PACK_NOT_FOUND: 'The original saved pack or project is unavailable.',
  CONTEXT_PACK_STALE: 'The gateway reports that the original pack sources changed.',
  CONTEXT_PACK_EXPIRED: 'The gateway reports that the original pack has expired.',
  CONTEXT_PACK_INVALID: 'The saved pack could not be validated. Keep the original request.',
  CONTEXT_PACK_STORAGE_UNAVAILABLE:
    'Context pack storage is unavailable. Keep the original request.',
  CONTEXT_SOURCE_LIMIT: 'The project or source graph exceeds the context pack limits.',
  IDEMPOTENCY_KEY_REUSED:
    'This request key belongs to different settings. Recover the exact original request.',
  WORKBENCH_AUTH_UNAVAILABLE:
    'Authentication is temporarily unavailable. Keep the original request.',
  AUDIT_PERSISTENCE_UNAVAILABLE:
    'The save audit could not be confirmed. Keep the original request.',
  RATE_LIMITED: 'Saving is temporarily busy. Keep the original request.',
  GATEWAY_REQUEST_TIMEOUT:
    'Stopped waiting for the save. It may still complete; keep the original request.',
  GATEWAY_RESPONSE_INVALID:
    'The complete save response could not be verified. Keep the original request.',
  GATEWAY_UNAVAILABLE: 'The save could not be confirmed. Keep the original request.',
  CONTEXT_PACK_INTEGRITY_UNAVAILABLE:
    'Saved content verification is unavailable. Keep the original request.',
  CONTEXT_PACK_HASH_MISMATCH:
    'The returned complete pack differs from its saved digest. Keep the original request.',
  CONTEXT_PACK_SAVE_CONTEXT_INVALID: 'The verified save identity could not be represented.',
};
const errorStatuses: Record<string, number> = {
  INVALID_INPUT: 400,
  DENIED: 403,
  CONTEXT_PACK_NOT_FOUND: 404,
  CONTEXT_PACK_STALE: 409,
  CONTEXT_PACK_EXPIRED: 410,
  CONTEXT_PACK_INVALID: 500,
  CONTEXT_PACK_STORAGE_UNAVAILABLE: 503,
  CONTEXT_SOURCE_LIMIT: 400,
  IDEMPOTENCY_KEY_REUSED: 409,
  WORKBENCH_AUTH_UNAVAILABLE: 503,
  AUDIT_PERSISTENCE_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  CONTEXT_PACK_SAVE_CONTEXT_INVALID: 500,
};
type Stage = 'input' | 'session' | 'integrity' | 'transport' | 'response';
export class ContextPackSaveError extends ContractError {
  constructor(
    code: string,
    trace: string,
    readonly dispatched: boolean,
    stage: Stage,
    readonly status?: number,
  ) {
    super(code, messages[code]!, {
      trace_id: trace,
      retryable: false,
      details: {
        compile_stage: stage,
        compile_dispatch_state: dispatched ? 'started' : 'not-sent',
        server_outcome: dispatched ? 'unknown' : 'not-checked',
        recovery:
          'Keep the original gateway, project, account/client, budget, lifetime and request key. Retry explicitly only with that same original request; this failure does not disprove an earlier save.',
      },
    });
  }
}

type SaveScope = { tenant_id: string; workspace_id: string; project_id: string };
type SaveFailure = (code: string, status?: number) => ContextPackSaveError;
async function readPackAuthority(
  captured: { token: string; scope: SaveScope; base: string },
  trace: string,
  signal: AbortSignal,
  active: () => void,
  fail: SaveFailure,
  expected?: PackSaveBinding,
) {
  let response: Response | undefined;
  try {
    active();
    response = await fetch(captured.base + '/v1/context-pack/save-context', {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal,
      headers: {
        authorization: 'Bearer ' + captured.token,
        accept: 'application/json',
        'x-trace-id': trace,
        'x-tenant-id': captured.scope.tenant_id,
        'x-workspace-id': captured.scope.workspace_id,
        'x-project-id': captured.scope.project_id,
        ...(expected
          ? {
              'x-expected-actor-id': expected.identity.actor_id,
              'x-expected-client-id': expected.identity.client_id,
            }
          : {}),
      },
    });
    active();
    if (response.status === 401) throw fail('UNAUTHENTICATED', 401);
    if (
      (response.status !== 200 && (response.status < 400 || response.status > 599)) ||
      response.headers.get('x-trace-id') !== trace ||
      response.headers.has('etag')
    )
      throw fail('GATEWAY_RESPONSE_INVALID');
    const raw = await readWorkbenchJsonResponse(response, signal, CONTEXT_PACK_SAVE_CONTEXT_BYTES);
    active();
    if (!response.ok) {
      const value: unknown = JSON.parse(syncJsonSnapshot(raw, CONTEXT_PACK_READ_ERROR_BYTES));
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
        ![
          'INVALID_INPUT',
          'DENIED',
          'RATE_LIMITED',
          'WORKBENCH_AUTH_UNAVAILABLE',
          'AUDIT_PERSISTENCE_UNAVAILABLE',
          'CONTEXT_PACK_SAVE_CONTEXT_INVALID',
        ].includes(error.code) ||
        errorStatuses[error.code] !== response.status
      )
        throw fail('GATEWAY_RESPONSE_INVALID');
      throw fail(error.code, response.status);
    }
    const result = parseContextPackSaveContextEnvelope(
      raw,
      expected?.identity ?? captured.scope,
      trace,
    );
    if (Date.parse(result.data.expires_at) <= Date.now()) throw fail('UNAUTHENTICATED');
    const binding = parsePackSaveBinding({
      gateway_url: captured.base,
      identity: result.data.identity,
      read_restricted: result.data.permissions.read_restricted,
    });
    if (expected) {
      try {
        assertPackSaveBinding(binding, expected);
      } catch {
        throw fail('DENIED');
      }
    }
    active();
    return { binding, expires_at: result.data.expires_at };
  } catch (error) {
    void response?.body?.cancel().catch(() => undefined);
    active();
    if (error instanceof ContextPackSaveError) throw error;
    throw fail(response ? 'GATEWAY_RESPONSE_INVALID' : 'GATEWAY_UNAVAILABLE');
  }
}

/** Identity discovery only. Its result never replaces an existing request's binding. */
export async function getWorkbenchContextPackSaveBinding() {
  const trace = 'trace_web_pack_identity_' + randomUUID();
  const fail: SaveFailure = (code, status) =>
    new ContextPackSaveError(code, trace, false, 'session', status);
  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession();
  } catch {
    throw fail('GATEWAY_UNAVAILABLE');
  }
  if (
    !session ||
    !session.access_token.trim() ||
    !Number.isSafeInteger(session.expires_at) ||
    session.expires_at * 1000 <= Date.now()
  )
    throw fail('UNAUTHENTICATED');
  const token = session.access_token;
  const expiry = session.expires_at;
  const claims = decodeJwtClaims(token);
  const scope = {
    tenant_id: claims.tenant_id ?? session.tenant_id ?? runtimeConfig.tenantId,
    workspace_id: claims.workspace_id ?? session.workspace_id ?? runtimeConfig.workspaceId,
    project_id: claims.project_id ?? session.project_id ?? runtimeConfig.projectId,
  };
  let base: string;
  try {
    base = packGateway(runtimeConfig.apiUrl);
    if (![scope.tenant_id, scope.workspace_id, scope.project_id].every(isUlid))
      throw new TypeError();
    new Headers({ authorization: 'Bearer ' + token });
  } catch {
    throw fail('INVALID_INPUT');
  }
  const controller = new AbortController();
  const deadline = performance.now() + 30_000;
  const active = () => {
    if (controller.signal.aborted || performance.now() >= deadline)
      throw fail('GATEWAY_REQUEST_TIMEOUT');
    if (expiry * 1000 <= Date.now()) throw fail('UNAUTHENTICATED');
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readPackAuthority({ token, scope, base }, trace, controller.signal, active, fail),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(fail('GATEWAY_REQUEST_TIMEOUT'));
        }, 30_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** Return only a complete verified receipt. One invocation sends at most one original save. */
export async function compileWorkbenchContextPack(
  budget: number,
  ttl: number,
  originalKey: string,
  originalBinding?: PackSaveBinding,
) {
  const trace = 'trace_web_pack_save_' + randomUUID();
  let dispatched = false;
  let stage: Stage = 'input';
  const fail = (code: string, status?: number) =>
    new ContextPackSaveError(code, trace, dispatched, stage, status);
  let parameters: ReturnType<typeof parseContextPackCompileParameters>;
  let key: string;
  let binding: PackSaveBinding | undefined;
  try {
    parameters = parseContextPackCompileParameters({ budget_tokens: budget, ttl_seconds: ttl });
    key = validateIdempotencyKey(originalKey);
    if (!isSyncIdentifier(key) || /\u007f/.test(key)) throw new TypeError();
    binding = originalBinding === undefined ? undefined : parsePackSaveBinding(originalBinding);
  } catch {
    throw fail('INVALID_INPUT');
  }
  stage = 'session';
  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession();
  } catch {
    throw fail('GATEWAY_UNAVAILABLE');
  }
  if (
    !session ||
    !session.access_token.trim() ||
    !Number.isSafeInteger(session.expires_at) ||
    session.expires_at * 1000 <= Date.now()
  )
    throw fail('UNAUTHENTICATED');
  const token = session.access_token;
  const expiry = session.expires_at;
  const claims = decodeJwtClaims(token);
  const scope = {
    tenant_id: claims.tenant_id ?? session.tenant_id ?? runtimeConfig.tenantId,
    workspace_id: claims.workspace_id ?? session.workspace_id ?? runtimeConfig.workspaceId,
    project_id: claims.project_id ?? session.project_id ?? runtimeConfig.projectId,
  };
  let base: URL;
  try {
    if (![scope.tenant_id, scope.workspace_id, scope.project_id].every(isUlid))
      throw new TypeError();
    base = new URL(runtimeConfig.apiUrl);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw new TypeError();
    new Headers({ authorization: 'Bearer ' + token, 'idempotency-key': key });
  } catch {
    throw fail('INVALID_INPUT');
  }
  if (
    binding &&
    (binding.gateway_url !== packGateway(base.href) ||
      binding.identity.tenant_id !== scope.tenant_id ||
      binding.identity.workspace_id !== scope.workspace_id ||
      binding.identity.project_id !== scope.project_id)
  )
    throw fail('DENIED');
  stage = 'integrity';
  let digest: ReturnType<typeof createHash>;
  try {
    digest = createHash('sha256');
  } catch {
    throw fail('CONTEXT_PACK_INTEGRITY_UNAVAILABLE');
  }
  const deadline = performance.now() + 30_000;
  const controller = new AbortController();
  let authorityExpiry = Infinity;
  const active = () => {
    if (controller.signal.aborted || performance.now() >= deadline)
      throw fail('GATEWAY_REQUEST_TIMEOUT');
    if (Math.min(expiry * 1000, authorityExpiry) <= Date.now()) throw fail('UNAUTHENTICATED');
  };
  let response: Response | undefined;
  const work = (async () => {
    try {
      active();
      if (binding) {
        stage = 'session';
        const authority = await readPackAuthority(
          { token, scope, base: binding.gateway_url },
          trace,
          controller.signal,
          active,
          fail,
          binding,
        );
        authorityExpiry = Date.parse(authority.expires_at);
        active();
      }
      stage = 'transport';
      const init: RequestInit = {
        method: 'POST',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          authorization: 'Bearer ' + token,
          accept: 'application/json',
          'content-type': 'application/json',
          'x-trace-id': trace,
          'x-tenant-id': scope.tenant_id,
          'x-workspace-id': scope.workspace_id,
          'x-project-id': scope.project_id,
          'idempotency-key': key,
          ...(binding
            ? {
                'x-expected-actor-id': binding.identity.actor_id,
                'x-expected-client-id': binding.identity.client_id,
              }
            : {}),
        },
        body: JSON.stringify(parameters),
      };
      active();
      dispatched = true;
      response = await fetch(
        (binding?.gateway_url ?? base.href.replace(/\/$/, '')) + '/v1/context-pack/compile',
        init,
      );
      stage = 'response';
      active();
      // Early HTTP authentication rejection can omit the normal business trace/body.
      if (response.status === 401) throw fail('UNAUTHENTICATED', 401);
      if (
        (response.status !== 200 && (response.status < 400 || response.status > 599)) ||
        response.headers.get('x-trace-id') !== trace ||
        (!response.ok && response.headers.has('etag'))
      )
        throw fail('GATEWAY_RESPONSE_INVALID');
      const raw = await readWorkbenchJsonResponse(
        response,
        controller.signal,
        CONTEXT_PACK_READ_RESPONSE_BYTES,
        CONTEXT_PACK_READ_ERROR_BYTES,
      );
      active();
      if (!response.ok) {
        const value: unknown = JSON.parse(syncJsonSnapshot(raw, CONTEXT_PACK_READ_ERROR_BYTES));
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          Object.keys(value).some(
            (field) => !['code', 'message', 'details', 'trace_id', 'retryable'].includes(field),
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
        throw fail(error.code, response.status);
      }
      const envelope = parseContextPackCompileEnvelope(raw, parameters, scope, trace);
      if (response.headers.get('etag') !== envelope.etag) throw fail('GATEWAY_RESPONSE_INVALID');
      active();
      const snapshot = contextPackReadHashJson(envelope.data.pack);
      active();
      stage = 'integrity';
      let hash: string;
      try {
        hash = 'sha256:' + digest.update(snapshot, 'utf8').digest('hex');
      } catch {
        active();
        throw fail('CONTEXT_PACK_INTEGRITY_UNAVAILABLE');
      }
      if (hash !== envelope.data.pack.pack_hash) throw fail('CONTEXT_PACK_HASH_MISMATCH');
      active();
      return envelope;
    } catch (error) {
      void response?.body?.cancel().catch(() => undefined);
      active();
      if (error instanceof ContextPackSaveError) throw error;
      throw fail(stage === 'transport' ? 'GATEWAY_UNAVAILABLE' : 'GATEWAY_RESPONSE_INVALID');
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
