import { performance } from 'node:perf_hooks';
import { ContractError } from '@planemem/contracts';
import { ApiGateway } from './http.js';
import { CommandRouter, type CommandRequest, type CommandResult } from './router.js';
import { SessionOriginBridge } from './session-origin-bridge.js';
import { sessionCurrentPath, sessionCurrentProtocol, type SessionCurrentAuthority, type SessionCurrentConfiguration,
  type SessionCurrentGrant, type SessionCurrentTarget } from './session-current.js';

export const sessionOriginPath = '/v1/continuity/session-origin';
export const sessionOriginOperation = 'session.origin.read';
export const sessionOriginProtocol = 'p02-session-origin-v1';
export const sessionOriginResponseBytes = 20 * 1024 * 1024;
export function isSessionSourcePath(path: string): boolean { return path === sessionCurrentPath || path === sessionOriginPath; }

export function registerSessionOriginRoute(router: CommandRouter, api: ApiGateway, reader?: SessionOriginReader,
  authorityFor?: (request: CommandRequest) => SessionCurrentAuthority): void {
  router.register(sessionOriginOperation, async request => {
    if (!reader || !authorityFor) throw unavailable(request.context.trace_id);
    const context = structuredClone(request.context);
    Object.freeze(context.capability); if (context.roles) Object.freeze(context.roles);
    const frozen: CommandRequest = Object.freeze({ operation: request.operation,
      input: Object.freeze(structuredClone(request.input)), context: Object.freeze(context),
      ...(request.signal === undefined ? {} : { signal: request.signal }) });
    return reader.read(frozen, () => router.authorize(frozen), authorityFor(request));
  });
  api.noStore(sessionOriginOperation);
  api.route('POST', sessionOriginPath, sessionOriginOperation);
}

/** Public proof read, independent from current-only v1. No original-operation writes or NoEffect
 * inference; both the dedicated origin capability and current ABP origin approval are required. */
export class SessionOriginReader {
  private readonly configuration: Readonly<SessionCurrentConfiguration>;
  constructor(private readonly bridge: SessionOriginBridge, configuration: SessionCurrentConfiguration) {
    this.configuration = Object.freeze({ ...configuration });
  }

  async read(request: CommandRequest, reauthorize: () => Promise<void>, authority: SessionCurrentAuthority): Promise<CommandResult> {
    const started = Date.now(); const elapsed = performance.now();
    const context = request.context;
    let expires = Math.min(started + 30_000, Date.parse(context.token_expires_at ?? ''));
    const controller = new AbortController(); const abort = () => controller.abort();
    request.signal?.addEventListener('abort', abort, { once: true });
    if (request.signal?.aborted) abort();
    let timeout = setTimeout(abort, 30_000);
    const tighten = () => {
      clearTimeout(timeout);
      timeout = setTimeout(abort, Math.max(0, Math.min(expires - Date.now(), 30_000 - (performance.now() - elapsed))));
    };
    const guard = () => {
      if (controller.signal.aborted || !Number.isFinite(expires) || Date.now() < started || Date.now() >= expires ||
          performance.now() - elapsed >= 30_000) throw unavailable(context.trace_id);
    };
    try {
      guard();
      const input = request.input;
      if (request.operation !== sessionOriginOperation || context.schema_version !== 1 || context.authenticated_client !== true ||
          !context.capability.includes('context.read') || !context.capability.includes('context.origin.read') ||
          !exact(input, ['protocol_version', 'endpoint_ref', 'configuration_digest', 'session_id', 'challenge', 'selection_id', 'selection_digest']) ||
          input.protocol_version !== sessionOriginProtocol || input.endpoint_ref !== this.configuration.endpoint_ref ||
          input.configuration_digest !== this.configuration.configuration_digest || !digest(input.configuration_digest) ||
          !digest(input.challenge) || !digest(input.selection_digest) || !id(input.session_id) ||
          typeof input.selection_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.selection_id) ||
          input.selection_id === '00000000-0000-0000-0000-000000000000' ||
          ![context.tenant_id, context.workspace_id, context.project_id].every(id) ||
          ![input.endpoint_ref, context.actor_id, context.client_id, context.trace_id].every(text)) throw unavailable(context.trace_id);
      const target: Readonly<SessionCurrentTarget> = Object.freeze({ protocol_version: sessionCurrentProtocol,
        endpoint_ref: this.configuration.endpoint_ref, configuration_digest: this.configuration.configuration_digest,
        tenant_id: context.tenant_id, workspace_id: context.workspace_id, project_id: context.project_id,
        actor_id: context.actor_id, client_id: context.client_id, session_id: input.session_id,
        challenge: input.challenge, trace_id: context.trace_id });
      tighten();
      const first = grant(await authority.authorize(target, controller.signal), target); guard();
      expires = Math.min(expires, Date.parse(first.expires_at)); guard(); tighten();
      const source = await this.bridge.observe(target, controller.signal,
        { selection_id: input.selection_id, selection_digest: input.selection_digest }); guard();
      const origin = structuredClone(source);
      if (origin.selection.selection_id !== input.selection_id || origin.selection_digest !== input.selection_digest)
        throw unavailable(context.trace_id);
      expires = Math.min(expires, Date.parse(origin.expires_at)); guard(); tighten();
      await reauthorize(); guard();
      const last = grant(await authority.authorize(target, controller.signal), target); guard();
      if (JSON.stringify(first) !== JSON.stringify(last)) throw unavailable(context.trace_id);
      await this.bridge.revalidate(origin, controller.signal); guard();
      const response: CommandResult = {
        schema_version: 1, trace_id: context.trace_id, source_refs: [{ type: 'session', id: target.session_id }],
        data: { protocol_version: sessionOriginProtocol, request: { ...input }, origin,
          authorization: { identity_digest: first.identity_digest, authorization_ref: first.authorization_ref,
            expires_at: new Date(Math.min(expires, Date.now() + 30_000 - (performance.now() - elapsed))).toISOString() } },
      };
      if (Buffer.byteLength(JSON.stringify(response), 'utf8') > sessionOriginResponseBytes) throw unavailable(context.trace_id);
      guard(); return response;
    } catch { throw unavailable(context.trace_id); }
    finally { clearTimeout(timeout); request.signal?.removeEventListener('abort', abort); }
  }
}
function grant(value: SessionCurrentGrant, target: Readonly<SessionCurrentTarget>): SessionCurrentGrant {
  if (!exact(value, ['target', 'identity_digest', 'authorization_ref', 'expires_at']) ||
      !exact(value.target, Object.keys(target)) || Object.entries(target).some(([key, expected]) => value.target[key as keyof SessionCurrentTarget] !== expected) ||
      !digest(value.identity_digest) || typeof value.authorization_ref !== 'string' ||
      !/^planemem-session-origin:[a-f0-9]{64}$/.test(value.authorization_ref) || !utc(value.expires_at)) throw new Error();
  return { ...value, target: { ...value.target } };
}
function exact(value: unknown, keys: string[]): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key));
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value); }
function digest(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function id(value: unknown): value is string { return typeof value === 'string' && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(value); }
function utc(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function unavailable(trace_id: string): ContractError {
  return new ContractError('OPERATION_UNAVAILABLE', 'Original session observation is unavailable', { trace_id, retryable: false });
}
