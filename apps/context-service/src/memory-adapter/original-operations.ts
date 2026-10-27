import { ContractError } from '@planemem/contracts';

export interface OriginalMemoryScope {
  workspace: string;
  project: string;
  workspace_id: string;
  project_id: string;
}
export interface OriginalMemoryStamp {
  protocol: 'ai-memory.operation.v1';
  workspace_id: string;
  project_id: string;
  operation_key: string;
  specification_digest: string;
  attempt: number;
}
export interface OriginalMemoryCommand {
  action: 'page.write' | 'handoff.create' | 'handoff.claim';
  arguments: Record<string, unknown> & {
    workspace: string;
    project: string;
    operation: OriginalMemoryStamp;
  };
}
export interface OriginalMemoryReceipt {
  protocol: 'ai-memory.operation.v1';
  receipt_id: string;
  recorded_at_us: number;
  outcome: 'succeeded' | 'no_effect';
  request: {
    attempt: number;
    binding: {
      workspace_id: string;
      project_id: string;
      operation_key: string;
      specification_digest: string;
      request_digest: string;
      actor: string;
      client_id: string;
      action: OriginalMemoryCommand['action'];
    };
  };
  result: Record<string, unknown> | null;
}
interface OriginalMemoryTransport {
  call(name: string, args: Record<string, unknown>, trace: string): Promise<unknown>;
  projects(workspace: string, trace: string): Promise<unknown>;
  tools(trace: string): Promise<unknown>;
}
const protocol = 'ai-memory.operation.v1';
const mutations = {
  'page.write': 'memory_write_page',
  'handoff.create': 'memory_handoff_begin',
  'handoff.claim': 'memory_handoff_accept',
} as const;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const digest = /^[a-f0-9]{64}$/;

/** Calls only the public original-operation protocol. There is no automatic redispatch. */
export class AiMemoryOriginalOperations {
  constructor(
    private readonly transport: OriginalMemoryTransport,
    private readonly identity: { actor_id?: string; client_id?: string },
  ) {}

  async isReady(trace: string): Promise<boolean> {
    if (!text(this.identity.actor_id) || !text(this.identity.client_id)) return false;
    try {
      const result = await this.transport.tools(trace);
      if (!object(result) || !Array.isArray(result.tools)) return false;
      const tools = result.tools;
      return (
        Object.values(mutations).every((name) => hasFields(tools, name, ['operation'])) &&
        ['memory_operation_query', 'memory_operation_close'].every((name) =>
          hasFields(tools, name, ['action', 'arguments']),
        )
      );
    } catch {
      return false;
    }
  }

  /** Resolve once before dispatch and persist the result with the complete command. */
  async resolveScope(
    workspace: string,
    project: string,
    trace: string,
  ): Promise<OriginalMemoryScope> {
    const projects = await this.transport.projects(workspace, trace);
    const matches = Array.isArray(projects)
      ? projects.filter(
          (item) =>
            object(item) && item.workspace_name === workspace && item.project_name === project,
        )
      : [];
    const row = matches[0];
    if (
      matches.length !== 1 ||
      !object(row) ||
      !matchesPattern(row.workspace_id, uuid) ||
      !matchesPattern(row.project_id, uuid)
    )
      throw failure(
        'MEMORY_SCOPE_UNAVAILABLE',
        'Exact existing ai-memory scope is unavailable',
        trace,
      );
    return { workspace, project, workspace_id: row.workspace_id, project_id: row.project_id };
  }

  async execute(input: OriginalMemoryCommand, trace: string): Promise<OriginalMemoryReceipt> {
    const command = this.freeze(input, trace);
    return this.decode(
      await this.transport.call(mutations[command.action], command.arguments, trace),
      command,
      trace,
    );
  }

  async readOriginalPage(
    workspace: string,
    project: string,
    path: string,
    pageId: string,
    trace: string,
  ): Promise<string> {
    const result = await this.transport.call(
      'memory_read_page',
      { workspace, project, path },
      trace,
    );
    if (!object(result) || result.page_id !== pageId || typeof result.body !== 'string')
      throw failure(
        'MEMORY_PAGE_VERSION_CONFLICT',
        'Original page version is no longer readable',
        trace,
      );
    return result.body;
  }
  async query(input: OriginalMemoryCommand, trace: string): Promise<OriginalMemoryReceipt | null> {
    const command = this.freeze(input, trace);
    const value = await this.transport.call('memory_operation_query', { ...command }, trace);
    if (!object(value) || value.protocol !== protocol) throw invalidReceipt(trace);
    if (value.outcome === 'unknown' && value.receipt === null) return null;
    const receipt = this.decode(value.receipt, command, trace);
    if (value.outcome !== receipt.outcome) throw invalidReceipt(trace);
    return receipt;
  }
  async close(input: OriginalMemoryCommand, trace: string): Promise<OriginalMemoryReceipt> {
    const command = this.freeze(input, trace);
    return this.decode(
      await this.transport.call('memory_operation_close', { ...command }, trace),
      command,
      trace,
    );
  }

  private freeze(input: OriginalMemoryCommand, trace: string): OriginalMemoryCommand {
    if (!object(input) || !Object.hasOwn(mutations, input.action) || !object(input.arguments))
      throw failure('INVALID_INPUT', 'Invalid original memory command', trace);
    const args = input.arguments;
    const stamp = args.operation;
    if (
      !text(this.identity.actor_id) ||
      this.identity.actor_id.trim() !== this.identity.actor_id ||
      !text(this.identity.client_id) ||
      this.identity.client_id.trim() !== this.identity.client_id ||
      !text(args.workspace) ||
      !text(args.project) ||
      !object(stamp) ||
      stamp.protocol !== protocol ||
      !matchesPattern(stamp.workspace_id, uuid) ||
      !matchesPattern(stamp.project_id, uuid) ||
      !text(stamp.operation_key) ||
      !matchesPattern(stamp.specification_digest, digest) ||
      !Number.isInteger(stamp.attempt) ||
      stamp.attempt < 1 ||
      stamp.attempt > 0xffffffff
    )
      throw failure(
        'INVALID_INPUT',
        'Original memory coordinates and identity are required',
        trace,
      );
    if (
      input.action === 'page.write' &&
      (args.create_only === true ||
        ['scope', 'session_id', 'expected_page_id'].some(
          (key) => args[key] !== undefined && args[key] !== null,
        ))
    )
      throw failure(
        'INVALID_INPUT',
        'Conditional and session page operations are unsupported',
        trace,
      );
    if (input.action === 'handoff.claim' && !matchesPattern(args.handoff_id, uuid))
      throw failure('INVALID_INPUT', 'Exact handoff UUID is required', trace);
    const serialized = JSON.stringify(input);
    if (Buffer.byteLength(serialized) > 128 * 1024)
      throw failure('INVALID_INPUT', 'Original memory command exceeds 128 KiB', trace);
    return JSON.parse(serialized) as OriginalMemoryCommand;
  }

  private decode(
    value: unknown,
    command: OriginalMemoryCommand,
    trace: string,
  ): OriginalMemoryReceipt {
    if (
      !object(value) ||
      value.protocol !== protocol ||
      !matchesPattern(value.receipt_id, uuid) ||
      !Number.isSafeInteger(value.recorded_at_us) ||
      (value.recorded_at_us as number) < 0 ||
      !object(value.request) ||
      !object(value.request.binding)
    )
      throw invalidReceipt(trace);
    const stamp = command.arguments.operation,
      binding = value.request.binding;
    if (
      value.request.attempt !== stamp.attempt ||
      binding.workspace_id !== stamp.workspace_id ||
      binding.project_id !== stamp.project_id ||
      binding.operation_key !== stamp.operation_key ||
      binding.specification_digest !== stamp.specification_digest ||
      binding.action !== command.action ||
      binding.actor !== `user:${this.identity.actor_id}` ||
      binding.client_id !== this.identity.client_id ||
      !matchesPattern(binding.request_digest, digest)
    )
      throw invalidReceipt(trace);
    if (value.outcome === 'no_effect') {
      if (value.result !== null) throw invalidReceipt(trace);
    } else if (value.outcome === 'succeeded' && object(value.result)) {
      const result = value.result;
      if (
        command.action === 'page.write' &&
        (!matchesPattern(result.page_id, uuid) ||
          !text(result.path) ||
          !matchesPattern(result.body_sha256, digest))
      )
        throw invalidReceipt(trace);
      if (command.action === 'handoff.create' && !matchesPattern(result.handoff_id, uuid))
        throw invalidReceipt(trace);
      if (
        command.action === 'handoff.claim' &&
        (result.status !== 'claimed' ||
          !object(result.handoff) ||
          result.handoff.id !== command.arguments.handoff_id)
      )
        throw invalidReceipt(trace);
    } else throw invalidReceipt(trace);
    return value as unknown as OriginalMemoryReceipt;
  }
}

function hasFields(tools: unknown[], name: string, fields: string[]): boolean {
  const tool = tools.find((tool) => object(tool) && tool.name === name);
  if (!object(tool) || !object(tool.inputSchema) || !object(tool.inputSchema.properties))
    return false;
  const properties = tool.inputSchema.properties;
  return fields.every((field) => Object.hasOwn(properties, field));
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function matchesPattern(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}
function invalidReceipt(trace: string): ContractError {
  return failure(
    'MEMORY_ORIGINAL_RECEIPT_INVALID',
    'Invalid or mismatched original receipt',
    trace,
  );
}
function failure(code: string, message: string, trace: string): ContractError {
  return new ContractError(code, message, { trace_id: trace, retryable: false });
}
