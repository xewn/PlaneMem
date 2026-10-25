import type { MemoryProvider } from '@planemem/domain';
import { InMemoryMemoryProvider, MemoryServiceAdapter } from './adapter.js';
import { AiMemoryMcpProvider, type AiMemoryMcpProviderOptions } from './mcp-provider.js';

export type MemoryProviderMode = 'in-memory' | 'ai-memory-mcp';

export interface MemoryServiceConfiguration {
  mode: MemoryProviderMode;
  enabled?: boolean;
  ai_memory?: AiMemoryMcpProviderOptions;
}

/** Creates the context boundary used by local fixtures and deployed services. */
export function createMemoryService(
  configuration: MemoryServiceConfiguration,
): MemoryServiceAdapter {
  let provider: MemoryProvider;
  if (configuration.mode === 'ai-memory-mcp') {
    if (!configuration.ai_memory) throw new Error('ai-memory provider configuration is required');
    provider = new AiMemoryMcpProvider(configuration.ai_memory);
  } else {
    provider = new InMemoryMemoryProvider();
  }
  return new MemoryServiceAdapter(provider, configuration.enabled ?? true);
}
