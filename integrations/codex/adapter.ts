export type ClientId = 'codex' | 'claude-code' | 'deepseek' | 'workbuddy';

export interface ClientCapabilities {
  client_id: ClientId;
  harness: string;
  mcp_version: string;
  context_budget: number;
  hooks: string[];
  trace_id: string;
}

export interface NegotiatedCapabilities {
  client_id: ClientId;
  mcp_version: string;
  context_budget: number;
  enabled: string[];
  degraded: string[];
  trace_id: string;
}

const supported = new Set(['resources', 'tools', 'prompts', 'handoff', 'context-pack']);

export class ClientAdapter {
  constructor(private readonly client_id: ClientId) {}

  register(
    input: Omit<ClientCapabilities, 'client_id'> & { client_id?: ClientId },
  ): ClientCapabilities {
    return { ...input, client_id: input.client_id ?? this.client_id };
  }

  negotiate(
    input: ClientCapabilities,
    server: { mcp_version: string; capabilities: string[]; max_context_budget: number },
  ): NegotiatedCapabilities {
    const enabled = server.capabilities.filter((capability) => supported.has(capability));
    const degraded = [...supported].filter((capability) => !enabled.includes(capability));
    return {
      client_id: input.client_id,
      mcp_version: server.mcp_version,
      context_budget: Math.min(input.context_budget, server.max_context_budget),
      enabled,
      degraded,
      trace_id: input.trace_id,
    };
  }

  doctor(input: ClientCapabilities): {
    schema_version: 1;
    client_id: ClientId;
    ready: boolean;
    trace_id: string;
    checks: Record<string, 'passed' | 'degraded'>;
  } {
    return {
      schema_version: 1,
      client_id: input.client_id,
      ready: input.mcp_version.length > 0 && input.context_budget > 0,
      trace_id: input.trace_id,
      checks: {
        mcp: input.mcp_version.length > 0 ? 'passed' : 'degraded',
        context_budget: input.context_budget > 0 ? 'passed' : 'degraded',
        hooks: input.hooks.length > 0 ? 'passed' : 'degraded',
      },
    };
  }

  finalizeSession(input: ClientCapabilities): {
    schema_version: 1;
    client_id: ClientId;
    finalized: true;
    trace_id: string;
  } {
    return {
      schema_version: 1,
      client_id: input.client_id,
      finalized: true,
      trace_id: input.trace_id,
    };
  }
}
