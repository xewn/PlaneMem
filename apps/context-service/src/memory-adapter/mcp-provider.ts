import { ContractError } from '@planemem/contracts';
import type { MemoryHit, MemoryProvider, MemoryRef, MemoryScope } from '@planemem/domain';

export interface AiMemoryMcpProviderOptions {
  serverUrl: string;
  token?: string;
  actor_id?: string;
  client_id?: string;
  timeout_ms?: number;
  fetch_impl?: typeof fetch;
}

interface AiMemoryPage {
  page_id: string;
  path: string;
  title?: string;
  body?: string;
  snippet?: string;
  score?: number;
}

interface JsonRpcResponse {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code?: number; message?: string; data?: unknown };
}

/**
 * Production provider for an ai-memory server's Streamable HTTP/MCP endpoint.
 *
 * The factory-facing MemoryProvider contract stays stable while this adapter
 * translates page/query operations to the ai-memory tool protocol. It never
 * reads the ai-memory SQLite or wiki directly.
 */
export class AiMemoryMcpProvider implements MemoryProvider {
  private readonly fetch_impl: typeof fetch;
  private readonly timeout_ms: number;
  private request_id = 0;
  private initialized: Promise<void> | undefined;
  private session_id: string | undefined;

  constructor(private readonly options: AiMemoryMcpProviderOptions) {
    if (!options.serverUrl.trim()) throw new Error('ai-memory serverUrl is required');
    this.fetch_impl = options.fetch_impl ?? fetch;
    this.timeout_ms = options.timeout_ms ?? 10_000;
  }

  async capture(input: MemoryScope & { content: string; trace_id: string }): Promise<MemoryRef> {
    const path = `planemem/captures/${safePathPart(input.trace_id)}.md`;
    const body = sanitize(input.content);
    let page: AiMemoryPage;
    try {
      page = await this.callTool<AiMemoryPage>(
        'memory_write_page',
        {
          workspace: input.workspace_id,
          project: input.project_id,
          path,
          body,
          create_only: true,
        },
        input.trace_id,
      );
    } catch (error) {
      if (
        !(error instanceof ContractError) ||
        error.envelope.code !== 'MEMORY_MCP_PRECONDITION_FAILED'
      )
        throw error;
      const existing = await this.readExternal(path, input, input.trace_id);
      if (sanitize(existing.body ?? '') !== body) {
        throw new ContractError(
          'MEMORY_CAPTURE_CONFLICT',
          'ai-memory already contains different content for this capture trace',
          { path, trace_id: input.trace_id, retryable: false },
        );
      }
      page = existing;
    }
    return toRef(page, input, body);
  }

  async recall(input: MemoryScope & { query: string; trace_id: string }): Promise<MemoryHit[]> {
    const result = await this.callTool<{ hits?: Array<Record<string, unknown>> }>(
      'memory_query',
      {
        workspace: input.workspace_id,
        project: input.project_id,
        query: input.query,
      },
      input.trace_id,
    );
    return (result.hits ?? []).map((hit, index) => {
      const page = parseHit(hit, input.trace_id);
      const pageRef = pageRefFor(input, page.path, page.page_id);
      return {
        ...toRef(page, input, page.snippet ?? '', pageRef),
        snippet: page.snippet ?? '',
        rank: index + 1,
      };
    });
  }

  async consolidate(
    input: MemoryScope & { page_ref: string; expected_revision: number; trace_id: string },
  ): Promise<MemoryRef> {
    const identity = parsePageRef(input.page_ref, input);
    const current = await this.readExternal(identity.path, input, input.trace_id);
    const currentRevision = revisionFor(current.page_id);
    if (currentRevision !== input.expected_revision) {
      throw new ContractError('MEMORY_REVISION_CONFLICT', 'Memory revision does not match', {
        page_ref: input.page_ref,
        expected_revision: input.expected_revision,
        current_revision: currentRevision,
        trace_id: input.trace_id,
        retryable: false,
      });
    }

    // ai-memory's LLM consolidation is a separate tool with session-level
    // inputs. At this stable provider boundary, a CAS rewrite preserves the
    // current page and advances its durable version without inventing content.
    const page = await this.callTool<AiMemoryPage>(
      'memory_write_page',
      {
        workspace: input.workspace_id,
        project: input.project_id,
        path: identity.path,
        body: current.body ?? '',
        expected_page_id: current.page_id,
      },
      input.trace_id,
    );
    return toRef(page, input, current.body ?? '');
  }

  async read_page(page_ref: string, scope: MemoryScope, trace_id: string): Promise<MemoryRef> {
    const identity = parsePageRef(page_ref, scope, trace_id);
    const page = await this.readExternal(identity.path, scope, trace_id);
    return toRef(
      page,
      { ...scope, trace_id },
      page.body ?? '',
      pageRefFor(scope, page.path, page.page_id),
    );
  }

  async restore_page(page_ref: string, scope: MemoryScope, trace_id: string): Promise<MemoryRef> {
    const identity = parsePageRef(page_ref, scope, trace_id);
    const page = await this.callTool<AiMemoryPage>(
      'memory_restore_page',
      {
        workspace: scope.workspace_id,
        project: scope.project_id,
        path: identity.path,
      },
      trace_id,
    );
    return toRef(
      page,
      { ...scope, trace_id },
      page.body ?? '',
      pageRefFor(scope, page.path, page.page_id),
    );
  }

  async create_handoff(
    page_ref: string,
    scope: MemoryScope,
    trace_id: string,
  ): Promise<{ schema_version: 1; handoff_ref: string; page_ref: string; trace_id: string }> {
    const identity = parsePageRef(page_ref, scope, trace_id);
    const page = await this.readExternal(identity.path, scope, trace_id);
    const result = await this.callTool<{ handoff_id?: string }>(
      'memory_handoff_begin',
      {
        workspace: scope.workspace_id,
        project: scope.project_id,
        summary: `PlaneMem context handoff for ${identity.path}: ${(page.body ?? '').slice(0, 2_000)}`,
        next_steps: [identity.path],
      },
      trace_id,
    );
    const handoffId = stringValue(result.handoff_id, 'handoff_id', trace_id);
    return {
      schema_version: 1,
      handoff_ref: `ai-memory-handoff://${encodePart(scope.workspace_id)}/${encodePart(scope.project_id)}/${encodePart(handoffId)}?page_ref=${encodeURIComponent(page_ref)}`,
      page_ref,
      trace_id,
    };
  }

  async claim_handoff(
    handoff_ref: string,
    _client_id: string,
  ): Promise<{ schema_version: 1; status: 'claimed' | 'already_claimed'; page_ref: string }> {
    const match = /^ai-memory-handoff:\/\/([^/]+)\/([^/]+)\/([^?]+)\?page_ref=(.+)$/.exec(
      handoff_ref,
    );
    if (!match)
      throw new ContractError('HANDOFF_NOT_FOUND', 'Handoff does not exist', {
        handoff_ref,
        trace_id: 'trace_handoff_unknown',
        retryable: false,
      });
    const workspace = decodeURIComponent(match[1]!);
    const project = decodeURIComponent(match[2]!);
    const handoff_id = decodeURIComponent(match[3]!);
    const page_ref = decodeURIComponent(match[4]!);
    const result = await this.callTool<unknown>(
      'memory_handoff_accept',
      {
        workspace,
        project,
        handoff_id,
      },
      'trace_handoff_claim',
    );
    // The pinned MCP protocol returns none_pending/consumed_by_hook with no
    // handoff. Neither proves that this client claimed the requested object.
    if (
      !isRecord(result) ||
      result.status !== 'claimed' ||
      !isRecord(result.handoff) ||
      result.handoff.id !== handoff_id
    ) {
      throw new ContractError(
        'MEMORY_HANDOFF_UNCONFIRMED',
        'The requested handoff claim was not confirmed',
        {
          handoff_ref,
          trace_id: 'trace_handoff_claim',
          retryable: false,
        },
      );
    }
    return {
      schema_version: 1,
      status: 'claimed',
      page_ref,
    };
  }

  private async readExternal(
    path: string,
    scope: MemoryScope,
    trace_id: string,
  ): Promise<AiMemoryPage> {
    return this.callTool<AiMemoryPage>(
      'memory_read_page',
      {
        workspace: scope.workspace_id,
        project: scope.project_id,
        path,
      },
      trace_id,
    );
  }

  private async callTool<T>(
    name: string,
    args: Record<string, unknown>,
    trace_id: string,
  ): Promise<T> {
    await this.ensureInitialized(trace_id);
    const rpc = await this.postRpc(
      {
        jsonrpc: '2.0',
        id: ++this.request_id,
        method: 'tools/call',
        params: { name, arguments: args },
      },
      trace_id,
    );
    if (rpc.error) {
      if (name === 'memory_write_page' && isPreconditionFailed(rpc.error.data)) {
        throw new ContractError(
          'MEMORY_MCP_PRECONDITION_FAILED',
          'ai-memory write precondition failed',
          {
            tool: name,
            ...(isRecord(rpc.error.data) ? rpc.error.data : {}),
            trace_id,
            retryable: false,
          },
        );
      }
      throw new ContractError('MEMORY_MCP_ERROR', rpc.error.message ?? 'ai-memory MCP error', {
        tool: name,
        rpc_code: rpc.error.code,
        trace_id,
        retryable: false,
      });
    }
    if (rpc.result?.isError) {
      throw new ContractError('MEMORY_MCP_TOOL_ERROR', `ai-memory tool ${name} failed`, {
        tool: name,
        trace_id,
        retryable: false,
      });
    }
    const text = rpc.result?.content?.find((item) => item.type === 'text')?.text;
    if (!text)
      throw new ContractError(
        'MEMORY_MCP_EMPTY_RESULT',
        `ai-memory tool ${name} returned no data`,
        { tool: name, trace_id },
      );
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ContractError(
        'MEMORY_MCP_INVALID_RESULT',
        `ai-memory tool ${name} returned invalid JSON`,
        {
          tool: name,
          trace_id,
          retryable: false,
        },
      );
    }
  }

  private async ensureInitialized(trace_id: string): Promise<void> {
    if (!this.initialized) {
      const initialization = this.postRpc(
        {
          jsonrpc: '2.0',
          id: ++this.request_id,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: this.options.client_id ?? 'planemem-context-service',
              version: '0.1.0',
            },
          },
        },
        trace_id,
      ).then(() => undefined);
      this.initialized = initialization.catch((error) => {
        this.initialized = undefined;
        this.session_id = undefined;
        throw error;
      });
    }
    await this.initialized;
  }

  private async postRpc(body: Record<string, unknown>, trace_id: string): Promise<JsonRpcResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout_ms);
    try {
      const response = await this.fetch_impl(`${this.options.serverUrl.replace(/\/$/, '')}/mcp`, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
          ...(this.options.actor_id ? { 'x-memory-actor-id': this.options.actor_id } : {}),
          ...(this.options.client_id ? { 'x-memory-client-id': this.options.client_id } : {}),
          'x-trace-id': trace_id,
          ...(this.session_id ? { 'mcp-session-id': this.session_id } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.session_id = undefined;
        throw new ContractError(
          'MEMORY_MCP_UNAVAILABLE',
          `ai-memory returned HTTP ${response.status}`,
          {
            status: response.status,
            trace_id,
            retryable: response.status >= 500,
          },
        );
      }
      const session = response.headers.get('mcp-session-id');
      if (session) this.session_id = session;
      return decodeRpc(await response.text(), trace_id);
    } catch (error) {
      if (error instanceof ContractError) throw error;
      throw new ContractError(
        'MEMORY_MCP_UNAVAILABLE',
        error instanceof Error ? error.message : 'ai-memory request failed',
        {
          trace_id,
          retryable: true,
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toRef(
  page: AiMemoryPage,
  scope: MemoryScope & { trace_id: string },
  content: string,
  ref?: string,
): MemoryRef {
  const page_ref = ref ?? pageRefFor(scope, page.path, page.page_id);
  return {
    schema_version: 1,
    tenant_id: scope.tenant_id,
    workspace_id: scope.workspace_id,
    project_id: scope.project_id,
    page_ref,
    revision: revisionFor(page.page_id),
    hash: `sha256:${simpleHash(content)}`,
    source_refs: [{ type: 'ai-memory', id: page_ref }],
    trace_id: scope.trace_id,
  };
}

function parseHit(value: Record<string, unknown>, trace_id: string): AiMemoryPage {
  const page_id = stringValue(value.id ?? value.page_id, 'id', trace_id);
  const path = stringValue(value.path, 'path', trace_id);
  return {
    page_id,
    path,
    ...(typeof value.title === 'string' ? { title: value.title } : {}),
    ...(typeof value.snippet === 'string' ? { snippet: value.snippet } : {}),
    ...(typeof value.score === 'number' ? { score: value.score } : {}),
  };
}

function parsePageRef(
  page_ref: string,
  scope: MemoryScope,
  trace_id = 'trace_memory_unknown',
): { path: string } {
  const prefix = `ai-memory://${encodePart(scope.workspace_id)}/${encodePart(scope.project_id)}/`;
  if (!page_ref.startsWith(prefix)) {
    throw new ContractError('MEMORY_PAGE_NOT_FOUND', 'Memory page is not available in this scope', {
      page_ref,
      trace_id,
      retryable: false,
    });
  }
  const encoded = page_ref.slice(prefix.length).split('?')[0];
  if (!encoded)
    throw new ContractError('MEMORY_PAGE_NOT_FOUND', 'Memory page path is missing', {
      page_ref,
      trace_id,
      retryable: false,
    });
  return { path: decodeURIComponent(encoded) };
}

function pageRefFor(scope: MemoryScope, path: string, page_id: string): string {
  return `ai-memory://${encodePart(scope.workspace_id)}/${encodePart(scope.project_id)}/${encodePart(path)}?page_id=${encodeURIComponent(page_id)}`;
}

function decodeRpc(raw: string, trace_id: string): JsonRpcResponse {
  const candidate =
    raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .at(-1) ?? raw;
  try {
    const parsed = JSON.parse(candidate) as JsonRpcResponse;
    if (!parsed || typeof parsed !== 'object') throw new Error('response must be an object');
    return parsed;
  } catch {
    throw new ContractError('MEMORY_MCP_INVALID_RESULT', 'ai-memory returned invalid JSON-RPC', {
      trace_id,
      retryable: false,
    });
  }
}

function stringValue(value: unknown, field: string, trace_id: string): string {
  if (typeof value !== 'string' || !value)
    throw new ContractError(
      'MEMORY_MCP_INVALID_RESULT',
      `ai-memory result field ${field} is missing`,
      { field, trace_id, retryable: false },
    );
  return value;
}

function isPreconditionFailed(value: unknown): boolean {
  return isRecord(value) && value.reason === 'precondition_failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120) || 'trace';
}

function sanitize(content: string): string {
  return content.replace(/<system>[\s\S]*?<\/system>/gi, '[redacted instruction]');
}

function revisionFor(pageId: string): number {
  return Math.max(1, simpleHash(pageId));
}

function simpleHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}
