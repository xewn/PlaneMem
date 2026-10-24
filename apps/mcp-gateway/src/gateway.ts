import { ContractError } from '@planemem/contracts';
import { CommandRouter, type CommandResult, type RequestContext } from '@planemem/api-gateway';

export interface McpClientCapabilities {
  resources?: { subscribe?: boolean };
  tools?: { listChanged?: boolean };
  prompts?: { listChanged?: boolean };
}

export interface McpContext extends RequestContext {
  capabilities: McpClientCapabilities;
}

export interface McpTool {
  name: string;
  description: string;
  operation: string;
}

type ResourceProvider =
  | (() =>
      | Promise<{ uri: string; mimeType: string; text: string }>
      | { uri: string; mimeType: string; text: string })
  | { uri: string; mimeType: string; text: string };

export class McpGateway {
  private readonly tools = new Map<string, McpTool>();
  private readonly resources = new Map<string, ResourceProvider>();
  private readonly prompts = new Map<string, (args: Record<string, unknown>) => string>();

  constructor(private readonly router: CommandRouter) {}

  registerTool(tool: McpTool): void {
    if (this.tools.has(tool.name))
      throw new ContractError('MCP_TOOL_ALREADY_REGISTERED', 'MCP tool is already registered', {
        tool: tool.name,
        trace_id: 'trace_mcp_register',
        retryable: false,
      });
    this.tools.set(tool.name, tool);
  }

  registerResource(uri: string, resource: ResourceProvider): void {
    this.resources.set(uri, resource);
  }

  registerPrompt(name: string, renderer: (args: Record<string, unknown>) => string): void {
    this.prompts.set(name, renderer);
  }

  initialize(
    protocolVersion: string,
    context: McpContext,
  ): {
    schema_version: 1;
    protocolVersion: string;
    serverInfo: { name: 'planemem-mcp'; version: '0.1.0' };
    capabilities: { tools: {}; resources: {}; prompts: {}; trace_id: string };
  } {
    if (!protocolVersion)
      throw new ContractError('MCP_PROTOCOL_UNSUPPORTED', 'MCP protocol version is required', {
        trace_id: context.trace_id,
        retryable: false,
      });
    return {
      schema_version: 1,
      protocolVersion,
      serverInfo: { name: 'planemem-mcp', version: '0.1.0' },
      capabilities: { tools: {}, resources: {}, prompts: {}, trace_id: context.trace_id },
    };
  }

  listTools(context: McpContext): { schema_version: 1; tools: McpTool[]; trace_id: string } {
    return {
      schema_version: 1,
      tools: [...this.tools.values()].map((tool) => ({ ...tool })),
      trace_id: context.trace_id,
    };
  }

  async callTool(
    name: string,
    input: Record<string, unknown>,
    context: McpContext,
  ): Promise<{
    schema_version: 1;
    content: Array<{ type: 'text'; text: string }>;
    trace_id: string;
    isError?: true;
  }> {
    const tool = this.tools.get(name);
    if (!tool)
      return {
        schema_version: 1,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ code: 'MCP_TOOL_NOT_FOUND', trace_id: context.trace_id }),
          },
        ],
        trace_id: context.trace_id,
        isError: true,
      };
    try {
      const result = await this.router.execute({ operation: tool.operation, input, context });
      return {
        schema_version: 1,
        content: [{ type: 'text', text: JSON.stringify(result) }],
        trace_id: result.trace_id,
      };
    } catch (error) {
      const message =
        error instanceof ContractError
          ? error.envelope
          : {
              code: 'INTERNAL_ERROR',
              message: error instanceof Error ? error.message : 'Unknown error',
              trace_id: context.trace_id,
            };
      return {
        schema_version: 1,
        content: [{ type: 'text', text: JSON.stringify(message) }],
        trace_id: context.trace_id,
        isError: true,
      };
    }
  }

  async readResource(
    uri: string,
    context: McpContext,
  ): Promise<{
    schema_version: 1;
    resource: { uri: string; mimeType: string; text: string };
    trace_id: string;
  }> {
    const renderer = this.resources.get(uri);
    if (!renderer)
      throw new ContractError('MCP_RESOURCE_NOT_FOUND', 'MCP resource does not exist', {
        uri,
        trace_id: context.trace_id,
        retryable: false,
      });
    const resource = typeof renderer === 'function' ? await renderer() : renderer;
    return { schema_version: 1, resource, trace_id: context.trace_id };
  }

  getPrompt(
    name: string,
    args: Record<string, unknown>,
    context: McpContext,
  ): { schema_version: 1; name: string; text: string; trace_id: string } {
    const renderer = this.prompts.get(name);
    if (!renderer)
      throw new ContractError('MCP_PROMPT_NOT_FOUND', 'MCP prompt does not exist', {
        name,
        trace_id: context.trace_id,
        retryable: false,
      });
    return {
      schema_version: 1,
      name,
      text: `Untrusted historical context follows:\n${renderer(args)}`,
      trace_id: context.trace_id,
    };
  }
}
