import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { ContractError } from '@planemem/contracts';
import { authenticatedContext, type VerifyGatewayToken } from './authenticated-context.js';
import type { CommandRequest, RequestContext } from './router.js';
import type { SessionCurrentAuthority, SessionCurrentGrant, SessionCurrentTarget } from './session-current.js';

export interface SessionCurrentOpaOptions {
  /** Exact protected decision URL, including /v1/data/planemem/session_current/decision. */
  decision_url: string;
  policy_revision: string;
  fetch_impl?: typeof fetch;
}

interface CallIdentity {
  context: RequestContext;
  identity: string;
  authorization: string;
  active: boolean;
}

/** Per-request private credential lifetime. No bearer is placed in CommandRequest, audit or output.
 * The production binding is entered ONLY after the gateway's authenticatedContext succeeded. */
export class SessionCurrentIdentityScope {
  private readonly calls = new AsyncLocalStorage<CallIdentity>();
  private readonly decisionUrl: string;
  private readonly revision: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly verify: VerifyGatewayToken, options: SessionCurrentOpaOptions) {
    const url = new URL(options.decision_url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.pathname !== '/v1/data/planemem/session_current/decision' ||
        url.href !== options.decision_url || !/^[a-f0-9]{64}$/.test(options.policy_revision))
      throw new Error('Current session authorization requires an exact HTTPS decision URL and policy revision');
    this.decisionUrl = url.href;
    this.revision = options.policy_revision;
    this.fetchImpl = options.fetch_impl ?? fetch;
  }

  async run<T>(context: RequestContext, authorization: string | undefined, work: () => Promise<T>): Promise<T> {
    if (this.calls.getStore() || !authorization?.startsWith('Bearer ') || authorization.length > 16_384 ||
        !authorization.slice(7).trim() || context.authenticated_client !== true)
      throw denied(context.trace_id);
    const call: CallIdentity = {
      context: structuredClone(context), identity: identityImage(context), authorization, active: true,
    };
    return this.calls.run(call, async () => {
      try { return await work(); }
      finally { call.active = false; call.authorization = ''; }
    });
  }

  forRequest(request: CommandRequest): SessionCurrentAuthority {
    const call = this.calls.getStore();
    if (!call || !call.active || identityImage(request.context) !== call.identity)
      throw denied(request.context.trace_id);
    return { authorize: target => this.authorize(call, request.signal, target) };
  }

  private async authorize(call: CallIdentity, signal: AbortSignal | undefined,
    target: Readonly<SessionCurrentTarget>): Promise<SessionCurrentGrant> {
    const guard = () => {
      if (!call.active || signal?.aborted || this.calls.getStore() !== call ||
          !Number.isFinite(Date.parse(call.context.token_expires_at ?? '')) ||
          Date.parse(call.context.token_expires_at!) <= Date.now()) throw denied(target.trace_id);
    };
    try {
      guard();
      for (const key of ['tenant_id', 'workspace_id', 'project_id', 'actor_id', 'client_id', 'trace_id'] as const)
        if (target[key] !== call.context[key]) throw denied(target.trace_id);
      const current = await authenticatedContext(call.context, target.trace_id, call.authorization, this.verify, true);
      guard();
      if (identityImage(current) !== call.identity || !current.capability.includes('context.read'))
        throw denied(target.trace_id);
      const tokenDigest = hash(call.authorization);
      const input = {
        action: 'session.current.read', target: { ...target },
        context: {
          tenant_id: current.tenant_id, workspace_id: current.workspace_id, project_id: current.project_id,
          actor_id: current.actor_id, client_id: current.client_id,
          authenticated_client: current.authenticated_client === true,
          capabilities: [...current.capability],
          token_expires_at_epoch_seconds: Date.parse(current.token_expires_at!) / 1000,
          token_digest: tokenDigest,
        },
      };
      const decision = await this.decision(input, signal);
      guard();
      if (decision.policy_revision !== this.revision || decision.allow !== true ||
          !Number.isSafeInteger(decision.expires_at_epoch_seconds) ||
          decision.expires_at_epoch_seconds * 1000 <= Date.now() ||
          decision.expires_at_epoch_seconds * 1000 > Date.parse(current.token_expires_at!) ||
          decision.endpoint_ref !== target.endpoint_ref ||
          decision.configuration_digest !== target.configuration_digest ||
          typeof decision.policy_digest !== 'string' || !/^[a-f0-9]{64}$/.test(decision.policy_digest))
        throw denied(target.trace_id);
      const { challenge: _challenge, trace_id: _trace, ...resource } = target;
      return {
        target: { ...target }, identity_digest: hash(JSON.stringify([identityImage(current, false), tokenDigest])),
        authorization_ref: `planemem-session-current:${hash(JSON.stringify([
          this.decisionUrl, this.revision, decision.policy_digest, resource,
        ]))}`,
        expires_at: new Date(decision.expires_at_epoch_seconds * 1000).toISOString(),
      };
    } catch {
      // Never serialize provider errors, token material, target contents or OPA response text.
      throw denied(target.trace_id);
    }
  }

  private async decision(input: unknown, signal: AbortSignal | undefined): Promise<CurrentDecision> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(abort, 5000);
    let response: Response | undefined;
    try {
      response = await this.fetchImpl(this.decisionUrl, {
        method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ input }), signal: controller.signal,
      });
      if (controller.signal.aborted || response.status !== 200 ||
          !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') ||
          response.headers.has('content-encoding') || !response.body) throw new Error();
      const reader = response.body.getReader();
      let complete = false;
      try {
        const chunks: Uint8Array[] = [];
        let length = 0;
        for (;;) {
          const item = await reader.read();
          if (controller.signal.aborted) throw new Error();
          if (item.done) { complete = true; break; }
          length += item.value.byteLength;
          if (length > 8192) throw new Error();
          chunks.push(item.value);
        }
        const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
        const parsed: unknown = JSON.parse(raw);
        if (!record(parsed) || Object.keys(parsed).some(key => key !== 'result') || !record(parsed.result) ||
            !exactKeys(parsed.result, ['allow', 'policy_revision', 'policy_digest', 'endpoint_ref',
              'configuration_digest', 'expires_at_epoch_seconds'])) throw new Error();
        const keys = [...raw.matchAll(/"(?:\\.|[^"\\])*"/gs)]
          .filter(match => /^\s*:/.test(raw.slice(match.index! + match[0].length)))
          .map(match => (JSON.parse(match[0]) as string).toLowerCase());
        if (keys.length !== 7 || new Set(keys).size !== 7) throw new Error();
        return parsed.result as unknown as CurrentDecision;
      } finally {
        if (!complete) await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } finally {
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (controller.signal.aborted) throw new Error();
    }
  }
}

interface CurrentDecision {
  allow: boolean;
  policy_revision: string;
  policy_digest: string;
  endpoint_ref: string;
  configuration_digest: string;
  expires_at_epoch_seconds: number;
}
function identityImage(context: RequestContext, includeTrace = true): string {
  return JSON.stringify({
    tenant_id: context.tenant_id, workspace_id: context.workspace_id, project_id: context.project_id,
    actor_id: context.actor_id, client_id: context.client_id,
    authenticated_client: context.authenticated_client === true, actor_type: context.actor_type ?? null,
    roles: [...(context.roles ?? [])].sort(), capabilities: [...context.capability].sort(),
    token_expires_at: context.token_expires_at ?? null,
    ...(includeTrace ? { trace_id: context.trace_id } : {}),
  });
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function denied(trace_id: string): ContractError {
  return new ContractError('DENIED', 'Current session authorization is unavailable', { trace_id, retryable: false });
}
