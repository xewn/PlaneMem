import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { ContractError, parseSessionResumeOrigin } from '@planemem/contracts';
import type { Session } from '@planemem/session-service';
import { CommandRouter, type CommandRequest, type CommandResult } from './router.js';
import { ApiGateway } from './http.js';
export interface SessionCurrentConfiguration {
  endpoint_ref: string;
  configuration_digest: string;
}

export const sessionCurrentProtocol = 'p02-session-current-v1';
export const sessionCurrentOperation = 'session.current.read';
export const sessionCurrentPath = '/v1/continuity/session-current';
const ulid = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const digest = /^[a-f0-9]{64}$/;

/** Bounded flat string-object grammar shared by current and origin requests; no nested payload. */
export function parseSessionCurrentRequest(bytes: Uint8Array): Record<string, unknown> {
  try {
    if (bytes.byteLength > 4096) throw new Error();
    const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.values(value).some(item => typeof item !== 'string')) throw new Error();
    // JSON.parse has checked escape syntax; with only string-valued top-level members every pair
    // contributes exactly two string tokens. Count before overwritten duplicate keys disappear.
    const tokens = raw.match(/"(?:\\.|[^"\\])*"/gs) ?? [];
    const names = tokens.filter((_token, index) => index % 2 === 0).map(token =>
      (JSON.parse(token) as string).toLowerCase());
    if (tokens.length !== Object.keys(value).length * 2 || new Set(names).size !== names.length)
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error('Current session request must be a bounded UTF-8 object with unique string fields');
  }
}

export interface SessionCurrentTarget extends SessionCurrentConfiguration {
  protocol_version: typeof sessionCurrentProtocol;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  actor_id: string;
  client_id: string;
  session_id: string;
  challenge: string;
  trace_id: string;
}

export interface SessionCurrentGrant {
  target: SessionCurrentTarget;
  /** Digest of independently authenticated identity, never a bearer token. */
  identity_digest: string;
  authorization_ref: string;
  expires_at: string;
}

/** Must authenticate independently and re-read current object permission on EVERY call.
 * Header claims, a role string, historical operation proofs and configuration alone are not authority.
 * The HTTP server intentionally has no default allowing implementation of this port. */
export interface SessionCurrentAuthority {
  authorize(target: Readonly<SessionCurrentTarget>, signal?: AbortSignal): Promise<SessionCurrentGrant>;
}

export interface SessionCurrentSnapshot {
  /** Exact public business projection text returned by the owning database statement. */
  session_json: string;
  observed_at: string;
  /** Optional additional owning-source approval deadline, never a caller-provided extension. */
  source_expires_at?: string;
  /** Trusted owning source callback only; never serialized into the HTTP result. */
  source_revalidate?: () => Promise<void>;
}

export interface SessionCurrentStore {
  read(target: Readonly<SessionCurrentTarget>, signal?: AbortSignal): Promise<SessionCurrentSnapshot | null>;
}

export function registerSessionCurrentRoute(router: CommandRouter, api: ApiGateway, reader?: SessionCurrentReader,
  authorityFor?: (request: CommandRequest) => SessionCurrentAuthority): void {
  router.register(sessionCurrentOperation, async request => {
    if (!reader) throw failure('OPERATION_UNAVAILABLE', request.context.trace_id);
    // Freeze request data used by the second policy/audit pass; do not allow a provider to renew it.
    const context = structuredClone(request.context);
    Object.freeze(context.capability);
    if (context.roles) Object.freeze(context.roles);
    const fixed: CommandRequest = Object.freeze({
      operation: request.operation, input: Object.freeze(structuredClone(request.input)),
      context: Object.freeze(context),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return reader.read(fixed, () => router.authorize(fixed), authorityFor?.(request));
  });
  api.noStore(sessionCurrentOperation);
  api.route('POST', sessionCurrentPath, sessionCurrentOperation);
}

/** Per-call state only; no historical result, domain Map or HTTP success cache is consulted. */
export class SessionCurrentReader {
  private readonly configuration: Readonly<SessionCurrentConfiguration>;

  constructor(
    private readonly store: SessionCurrentStore,
    configuration: SessionCurrentConfiguration,
    private readonly authority?: SessionCurrentAuthority,
  ) {
    this.configuration = Object.freeze({ ...configuration });
  }

  async read(request: CommandRequest, reauthorize: () => Promise<void>,
    authority: SessionCurrentAuthority | undefined = this.authority): Promise<CommandResult> {
    const started = Date.now();
    const elapsed = performance.now();
    const tokenExpiresAt = Date.parse(request.context.token_expires_at ?? '');
    let sourceExpiresAt = tokenExpiresAt;
    const target = Object.freeze(this.target(request));
    const guard = () => {
      if (request.signal?.aborted || !Number.isFinite(tokenExpiresAt) || tokenExpiresAt <= Date.now() || sourceExpiresAt <= Date.now())
        throw failure('DENIED', target.trace_id);
      if (Date.now() < started || Date.now() - started >= 30_000 ||
          performance.now() - elapsed >= 30_000)
        throw failure('OPERATION_UNAVAILABLE', target.trace_id);
    };
    guard();
    if (!authority) throw failure('OPERATION_UNAVAILABLE', target.trace_id);
    const first = await this.authorize(authority, target);
    sourceExpiresAt = Math.min(sourceExpiresAt, Date.parse(first.expires_at));
    guard();
    let snapshot: SessionCurrentSnapshot | null;
    try {
      snapshot = await this.store.read(target, request.signal);
    } catch {
      throw failure('OPERATION_UNAVAILABLE', target.trace_id);
    }
    guard();
    // Copy the complete source before an independently asynchronous authorization boundary.
    const frozen = snapshot === null ? null : Object.freeze({ ...snapshot });
    if (frozen?.source_expires_at !== undefined) {
      if (!utc(frozen.source_expires_at)) throw failure('OPERATION_RESULT_INVALID', target.trace_id);
      sourceExpiresAt = Math.min(sourceExpiresAt, Date.parse(frozen.source_expires_at));
      guard();
    }
    const session = frozen === null ? null : readSessionCurrentSnapshot(frozen, target);
    await reauthorize(); // Includes the actual router policy and its durable audit sink.
    guard();
    const last = await this.authorize(authority, target);
    guard();
    if (JSON.stringify(first) !== JSON.stringify(last) || Date.parse(first.expires_at) <= Date.now())
      throw failure('DENIED', target.trace_id);
    if (frozen?.source_revalidate) { await frozen.source_revalidate(); guard(); }
    // Missing and wrong-owner rows are indistinguishable, and both require final authorization.
    if (!frozen || !session) throw failure('NOT_FOUND', target.trace_id);
    return {
      schema_version: 1,
      trace_id: target.trace_id,
      source_refs: [{ type: 'session', id: target.session_id }],
      data: {
        ...target,
        observed_at: frozen.observed_at,
        session_json: frozen.session_json,
        session_digest: createHash('sha256').update(frozen.session_json, 'utf8').digest('hex'),
        authorization: {
          identity_digest: first.identity_digest,
          authorization_ref: first.authorization_ref,
          expires_at: new Date(Math.min(Date.parse(first.expires_at), sourceExpiresAt)).toISOString(),
        },
      },
    };
  }

  private async authorize(authority: SessionCurrentAuthority, target: SessionCurrentTarget): Promise<SessionCurrentGrant> {
    try {
      return this.grant(await authority.authorize(target), target);
    } catch {
      throw failure('DENIED', target.trace_id);
    }
  }

  private target(request: CommandRequest): SessionCurrentTarget {
    const input = request.input;
    const context = request.context;
    if (request.operation !== sessionCurrentOperation || context.schema_version !== 1 ||
        !exactKeys(input, ['protocol_version', 'endpoint_ref', 'configuration_digest', 'session_id', 'challenge']) ||
        input.protocol_version !== sessionCurrentProtocol ||
        !text(this.configuration.endpoint_ref, 512) || !digest.test(this.configuration.configuration_digest) ||
        input.endpoint_ref !== this.configuration.endpoint_ref ||
        input.configuration_digest !== this.configuration.configuration_digest ||
        typeof input.session_id !== 'string' || !ulid.test(input.session_id) ||
        typeof input.challenge !== 'string' || !digest.test(input.challenge) ||
        ![context.tenant_id, context.workspace_id, context.project_id].every(x => typeof x === 'string' && ulid.test(x)) ||
        ![context.actor_id, context.client_id, context.trace_id].every(x => text(x, 512)))
      throw failure('INVALID_REQUEST_CONTEXT', context.trace_id);
    return {
      protocol_version: sessionCurrentProtocol,
      ...this.configuration,
      tenant_id: context.tenant_id,
      workspace_id: context.workspace_id,
      project_id: context.project_id,
      actor_id: context.actor_id,
      client_id: context.client_id,
      session_id: input.session_id,
      challenge: input.challenge,
      trace_id: context.trace_id,
    };
  }

  private grant(value: SessionCurrentGrant, target: SessionCurrentTarget): SessionCurrentGrant {
    if (!value || !exactKeys(value, ['target', 'identity_digest', 'authorization_ref', 'expires_at']) ||
        !value.target || !exactKeys(value.target, Object.keys(target)) ||
        Object.entries(target).some(([key, expected]) => value.target[key as keyof SessionCurrentTarget] !== expected) ||
        typeof value.identity_digest !== 'string' || !digest.test(value.identity_digest) ||
        !text(value.authorization_ref, 512) || !utc(value.expires_at) ||
        Date.parse(value.expires_at) <= Date.now())
      throw failure('DENIED', target.trace_id);
    return {
      target: { ...target }, identity_digest: value.identity_digest,
      authorization_ref: value.authorization_ref, expires_at: value.expires_at,
    };
  }
}

/** The production store creates JSON from typed SQL columns, so duplicate JSON keys cannot originate
 * here. This function is NOT a parser for arbitrary remote/raw JSON supplied by clients. */
export function readSessionCurrentSnapshot(snapshot: SessionCurrentSnapshot, target: SessionCurrentTarget): Session {
  const fail = () => failure('OPERATION_RESULT_INVALID', target.trace_id);
  if (typeof snapshot.session_json !== 'string' || Buffer.byteLength(snapshot.session_json, 'utf8') > 65_536 ||
      !utc(snapshot.observed_at)) throw fail();
  let value: Session;
  try { value = JSON.parse(snapshot.session_json) as Session; } catch { throw fail(); }
  const required = ['schema_version', 'tenant_id', 'workspace_id', 'project_id', 'session_id',
    'client_id', 'actor_id', 'status', 'version', 'started_at', 'trace_id', 'source_refs'];
  if (!value || !exactKeys(value, required, ['parent_session_id', 'resume_origin', 'ended_at']) || value.schema_version !== 1 ||
      ['tenant_id', 'workspace_id', 'project_id', 'session_id', 'client_id', 'actor_id']
        .some(key => value[key as keyof Session] !== target[key as keyof SessionCurrentTarget]) ||
      !Number.isSafeInteger(value.version) || value.version < 1 ||
      !['running', 'paused', 'ended', 'abandoned', 'failed'].includes(value.status) ||
      !text(value.trace_id, 512) || !utc(value.started_at) ||
      (value.parent_session_id !== undefined && !ulid.test(value.parent_session_id)) ||
      (value.ended_at !== undefined && (!utc(value.ended_at) || Date.parse(value.ended_at) < Date.parse(value.started_at))) ||
      ((value.status === 'running' || value.status === 'paused') && value.ended_at !== undefined) ||
      (value.status === 'ended' && value.ended_at === undefined) ||
      !Array.isArray(value.source_refs) || value.source_refs.length > 256 ||
      value.source_refs.some(ref => !ref || !exactKeys(ref, ['type', 'id'], ['revision', 'uri']) ||
        !text(ref.type, 128) || !text(ref.id, 2048) ||
        (ref.revision !== undefined && (!Number.isSafeInteger(ref.revision) || ref.revision < 0)) ||
        (ref.uri !== undefined && !text(ref.uri, 4096)))) throw fail();
  if (value.resume_origin !== undefined) {
    try { parseSessionResumeOrigin(value.resume_origin); } catch { throw fail(); }
    if (!value.parent_session_id || !ulid.test(value.resume_origin.handoff_id) ||
        !ulid.test(value.resume_origin.checkpoint_id)) throw fail();
  }
  return value;
}

function exactKeys(value: object, required: string[], optional: string[] = []): boolean {
  return !Array.isArray(value) && required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function text(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value);
}
function utc(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function failure(code: string, trace_id: string): ContractError {
  return new ContractError(code, 'Current session observation is unavailable', { trace_id, retryable: false });
}
