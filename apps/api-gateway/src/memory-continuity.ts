import { createHash } from 'node:crypto';
import { ContractError } from '@planemem/contracts';
import type {
  OriginalMemoryCommand,
  OriginalMemoryReceipt,
  OriginalMemoryScope,
} from '@planemem/context-service';
import {
  continuityProtocol,
  memoryContinuityActions,
  type ContinuityConfiguration,
  type ContinuityRequest,
  type OperationProof,
} from './continuity-operations.js';
import type { RequestContext } from './router.js';

export interface OriginalMemoryPort {
  isReady(trace: string): Promise<boolean>;
  resolveScope(workspace: string, project: string, trace: string): Promise<OriginalMemoryScope>;
  readOriginalPage(
    workspace: string,
    project: string,
    path: string,
    pageId: string,
    trace: string,
  ): Promise<string>;
  execute(command: OriginalMemoryCommand, trace: string): Promise<OriginalMemoryReceipt>;
  query(command: OriginalMemoryCommand, trace: string): Promise<OriginalMemoryReceipt | null>;
  close(command: OriginalMemoryCommand, trace: string): Promise<OriginalMemoryReceipt>;
}
type Caller = Pick<
  RequestContext,
  'tenant_id' | 'workspace_id' | 'project_id' | 'actor_id' | 'client_id' | 'trace_id'
>;
export interface PreparedMemoryOperation {
  operation_key: string;
  fingerprint: string;
  server_url: string;
  request: ContinuityRequest;
  caller: Caller;
  command: OriginalMemoryCommand;
}
/** putIfAbsent returns only after commit, reading back the winning original row. */
export interface PreparedMemoryStore {
  isReady(): Promise<boolean>;
  get(key: string): Promise<PreparedMemoryOperation | null>;
  putIfAbsent(record: PreparedMemoryOperation): Promise<PreparedMemoryOperation>;
}

/** PlaneMem owns the frozen outbound mapping; ai-memory owns the mutation and its original proof. */
export class MemoryContinuityOperations {
  constructor(
    private readonly store: PreparedMemoryStore,
    private readonly configuration: ContinuityConfiguration,
    private readonly serverUrl: string,
    private readonly provider: (caller: Caller) => OriginalMemoryPort,
  ) {}

  async isReady(caller: Caller): Promise<boolean> {
    try {
      return (await this.store.isReady()) && (await this.provider(caller).isReady(caller.trace_id));
    } catch {
      return false;
    }
  }
  execute(request: ContinuityRequest, context: RequestContext): Promise<OperationProof> {
    return this.change(request, context, 'execute');
  }
  close(request: ContinuityRequest, context: RequestContext): Promise<OperationProof> {
    return this.change(request, context, 'close');
  }
  async query(request: ContinuityRequest, context: RequestContext): Promise<OperationProof | null> {
    const input = this.freeze(request, context);
    const original = await this.store.get(input.request.operation_key);
    if (!original) return null;
    this.match(original, input.fingerprint, context);
    const command = forAttempt(original.command, input.request.dispatch_attempt);
    const receipt = await this.provider(original.caller).query(command, original.caller.trace_id);
    return receipt ? this.proof(original, receipt) : null;
  }
  private async change(
    request: ContinuityRequest,
    context: RequestContext,
    action: 'execute' | 'close',
  ): Promise<OperationProof> {
    const input = this.freeze(request, context);
    let original = await this.store.get(input.request.operation_key);
    if (!original) {
      const port = this.provider(input.caller);
      const scope = await port.resolveScope(
        input.caller.workspace_id,
        input.caller.project_id,
        input.caller.trace_id,
      );
      let handoffBody: string | undefined;
      if (input.request.action === 'handoff.create') {
        const page = parsePage(input.request.payload.page_ref, input.caller);
        handoffBody = await port.readOriginalPage(
          scope.workspace,
          scope.project,
          page.path,
          page.page_id,
          input.caller.trace_id,
        );
      }
      const candidate: PreparedMemoryOperation = {
        ...input,
        server_url: this.serverUrl,
        operation_key: input.request.operation_key,
        command: toMemoryCommand(input.request, input.caller, scope, handoffBody),
      };
      // No external mutation is possible until the immutable command is durably readable.
      original = await this.store.putIfAbsent(candidate);
    }
    this.match(original, input.fingerprint, context);
    const receipt = await this.provider(original.caller)[action](
      forAttempt(original.command, input.request.dispatch_attempt),
      original.caller.trace_id,
    );
    return this.proof(original, receipt);
  }
  private match(
    original: PreparedMemoryOperation,
    fingerprint: string,
    context: RequestContext,
  ): void {
    if (original.fingerprint !== fingerprint || original.server_url !== this.serverUrl)
      throw failure(
        'IDEMPOTENCY_KEY_REUSED',
        'Operation key belongs to another immutable request',
        context,
      );
  }
  private freeze(request: ContinuityRequest, context: RequestContext) {
    if (
      !request ||
      request.protocol_version !== continuityProtocol ||
      request.endpoint_ref !== this.configuration.endpoint_ref ||
      request.configuration_digest !== this.configuration.configuration_digest
    )
      throw failure(
        'OPERATION_CONFIGURATION_CONFLICT',
        'Protocol or configured endpoint does not match',
        context,
      );
    if (!memoryContinuityActions.includes(request.action as never))
      throw failure(
        'OPERATION_UNSUPPORTED',
        'Action has no durable memory implementation',
        context,
      );
    if (
      !text(request.operation_key, 256) ||
      !/^[a-f0-9]{64}$/.test(request.specification_digest) ||
      !Number.isInteger(request.dispatch_attempt) ||
      request.dispatch_attempt < 1 ||
      request.dispatch_attempt > 0xffffffff ||
      (request.expected_revision !== undefined && request.expected_revision !== null) ||
      !object(request.payload) ||
      Buffer.byteLength(JSON.stringify(request)) > 128 * 1024
    )
      throw failure('INVALID_INPUT', 'Invalid original memory request', context);
    const caller: Caller = {
      tenant_id: context.tenant_id,
      workspace_id: context.workspace_id,
      project_id: context.project_id,
      actor_id: context.actor_id,
      client_id: context.client_id,
      trace_id: context.trace_id,
    };
    if (Object.values(caller).some((value) => !text(value, 256) || value !== value.trim()))
      throw failure('INVALID_INPUT', 'Original caller coordinates are required', context);
    const allowed: Record<string, string[]> = {
      'evidence.write': ['title', 'summary', 'evidence_ref', 'source_refs'],
      'handoff.create': ['page_ref'],
      'handoff.claim': ['handoff_ref'],
    };
    if (Object.keys(request.payload).some((key) => !allowed[request.action]!.includes(key)))
      throw failure('INVALID_INPUT', 'Fields outside the memory action contract', context);
    const p = request.payload;
    if (request.action === 'evidence.write') {
      if (
        !text(p.title, 1024) ||
        !text(p.summary, 16384) ||
        !text(p.evidence_ref, 2048) ||
        !Array.isArray(p.source_refs) ||
        p.source_refs.length > 99 ||
        p.source_refs.some((ref) => !object(ref) || !text(ref.type, 128) || !text(ref.id, 2048))
      )
        throw failure(
          'INVALID_INPUT',
          'Evidence requires title, summary and bounded source references',
          context,
        );
    } else if (request.action === 'handoff.create') parsePage(p.page_ref, caller);
    else parseHandoff(p.handoff_ref, caller);
    const frozen = structuredClone({ request, caller });
    const { dispatch_attempt: _, ...binding } = frozen.request;
    return {
      ...frozen,
      fingerprint: hash({ request: binding, caller: frozen.caller, server_url: this.serverUrl }),
    };
  }
  private proof(original: PreparedMemoryOperation, receipt: OriginalMemoryReceipt): OperationProof {
    const request = original.request,
      caller = original.caller;
    let data: Record<string, unknown> | null = null;
    let revision: number | null = null;
    let refs: Array<{ type: string; id: string }> = [];
    if (receipt.outcome === 'succeeded') {
      const result = receipt.result!;
      if (request.action === 'evidence.write') {
        const pageRef = pageReference(caller, result.path as string, result.page_id as string);
        revision = revisionFor(result.page_id as string);
        refs = [
          ...(request.payload.source_refs as Array<{ type: string; id: string }>),
          { type: 'ai-memory', id: pageRef },
        ];
        data = {
          schema_version: 1,
          tenant_id: caller.tenant_id,
          workspace_id: caller.workspace_id,
          project_id: caller.project_id,
          page_ref: pageRef,
          revision,
          hash: `sha256:${result.body_sha256}`,
          evidence_ref: request.payload.evidence_ref,
          source_refs: refs,
          trace_id: caller.trace_id,
        };
      } else if (request.action === 'handoff.create') {
        const pageRef = request.payload.page_ref as string;
        const handoffRef = `ai-memory-handoff://${encodeURIComponent(caller.workspace_id)}/${encodeURIComponent(caller.project_id)}/${result.handoff_id}?page_ref=${encodeURIComponent(pageRef)}`;
        refs = [{ type: 'ai-memory', id: pageRef }];
        data = {
          schema_version: 1,
          handoff_ref: handoffRef,
          page_ref: pageRef,
          trace_id: caller.trace_id,
        };
      } else {
        const { page_ref } = parseHandoff(request.payload.handoff_ref, caller);
        refs = [{ type: 'ai-memory', id: page_ref }];
        data = { schema_version: 1, status: 'claimed', page_ref };
      }
    }
    return {
      protocol_version: continuityProtocol,
      operation_key: request.operation_key,
      specification_digest: request.specification_digest,
      scope: {
        tenant_id: caller.tenant_id,
        workspace_id: caller.workspace_id,
        project_id: caller.project_id,
      },
      action: request.action,
      actor_id: caller.actor_id,
      client_id: caller.client_id,
      endpoint_ref: request.endpoint_ref,
      configuration_digest: request.configuration_digest,
      dispatch_attempt: receipt.request.attempt,
      outcome: receipt.outcome === 'succeeded' ? 'ConfirmedEffect' : 'ConfirmedNoEffect',
      receipt_ref: `ai-memory-operation:${receipt.receipt_id}`,
      revision,
      result: data
        ? { schema_version: 1, trace_id: caller.trace_id, source_refs: refs, data }
        : null,
      source_refs: refs,
      observed_at: microsecondTimestamp(receipt.recorded_at_us),
    };
  }
}

function toMemoryCommand(
  request: ContinuityRequest,
  caller: Caller,
  scope: OriginalMemoryScope,
  handoffBody?: string,
): OriginalMemoryCommand {
  const operation = {
    protocol: 'ai-memory.operation.v1' as const,
    workspace_id: scope.workspace_id,
    project_id: scope.project_id,
    operation_key: `planemem:${hash(request.operation_key)}`,
    specification_digest: request.specification_digest,
    attempt: 1,
  };
  const common = { workspace: scope.workspace, project: scope.project, operation };
  const p = request.payload;
  if (request.action === 'evidence.write')
    return {
      action: 'page.write',
      arguments: {
        ...common,
        path: `planemem/evidence/${hash(request.operation_key)}.md`,
        title: p.title,
        body: `# ${p.title}\n\n${p.summary}\n\nEvidence: ${p.evidence_ref}\n\nSource references: ${JSON.stringify(p.source_refs)}\n`,
      },
    };
  if (request.action === 'handoff.create')
    return {
      action: 'handoff.create',
      arguments: {
        ...common,
        summary: `PlaneMem context handoff for ${p.page_ref}: ${handoffBody!.slice(0, 2000)}`,
        next_steps: [parsePage(p.page_ref, caller).path],
      },
    };
  return {
    action: 'handoff.claim',
    arguments: { ...common, handoff_id: parseHandoff(p.handoff_ref, caller).handoff_id },
  };
}
function forAttempt(command: OriginalMemoryCommand, attempt: number): OriginalMemoryCommand {
  const result = structuredClone(command);
  result.arguments.operation.attempt = attempt;
  return result;
}
function pageReference(caller: Caller, path: string, pageId: string): string {
  return `ai-memory://${encodeURIComponent(caller.workspace_id)}/${encodeURIComponent(caller.project_id)}/${encodeURIComponent(path)}?page_id=${pageId}`;
}
function parsePage(value: unknown, caller: Caller): { path: string; page_id: string } {
  const prefix = `ai-memory://${encodeURIComponent(caller.workspace_id)}/${encodeURIComponent(caller.project_id)}/`;
  if (!text(value, 2048) || !value.startsWith(prefix))
    throw failure('INVALID_INPUT', 'Page reference is outside the fixed scope', caller);
  const [path, query] = value.slice(prefix.length).split('?');
  const page_id = new URLSearchParams(query).get('page_id') ?? '';
  if (!path || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(page_id))
    throw failure('INVALID_INPUT', 'An exact original page reference is required', caller);
  try {
    return { path: decodeURIComponent(path), page_id };
  } catch {
    throw failure('INVALID_INPUT', 'Invalid encoded page reference', caller);
  }
}
function parseHandoff(value: unknown, caller: Caller): { handoff_id: string; page_ref: string } {
  const prefix = `ai-memory-handoff://${encodeURIComponent(caller.workspace_id)}/${encodeURIComponent(caller.project_id)}/`;
  if (!text(value, 8192) || !value.startsWith(prefix))
    throw failure('INVALID_INPUT', 'Handoff reference is outside the fixed scope', caller);
  const [handoff_id, query] = value.slice(prefix.length).split('?');
  const page_ref = new URLSearchParams(query).get('page_ref');
  if (
    !handoff_id ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(handoff_id) ||
    !page_ref
  )
    throw failure('INVALID_INPUT', 'An exact original handoff reference is required', caller);
  parsePage(page_ref, caller);
  return { handoff_id, page_ref };
}
function revisionFor(id: string): number {
  let value = 2166136261;
  for (const char of id) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return Math.max(1, value >>> 0);
}
function microsecondTimestamp(value: number): string {
  const seconds = Math.floor(value / 1000000);
  return new Date(seconds * 1000)
    .toISOString()
    .replace('.000Z', `.${String(value - seconds * 1000000).padStart(6, '0')}Z`);
}
function hash(value: unknown): string {
  function stable(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(stable);
    if (object(item))
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, stable(v)]),
      );
    return item;
  }
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function failure(code: string, message: string, caller: Pick<Caller, 'trace_id'>): ContractError {
  return new ContractError(code, message, { trace_id: caller.trace_id, retryable: false });
}
