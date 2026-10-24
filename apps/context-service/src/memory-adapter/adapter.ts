import { ContractError, createUlid } from '@planemem/contracts';
import type { MemoryHit, MemoryProvider, MemoryRef, MemoryScope } from '@planemem/domain';

export type { MemoryHit, MemoryProvider, MemoryRef, MemoryScope } from '@planemem/domain';

interface StoredPage {
  ref: MemoryRef;
  content: string;
}

export class InMemoryMemoryProvider implements MemoryProvider {
  private readonly pages = new Map<string, StoredPage>();
  private sequence = 0;

  async capture(input: MemoryScope & { content: string; trace_id: string }): Promise<MemoryRef> {
    const page_ref = `memory://${input.project_id}/page-${++this.sequence}`;
    const content = sanitize(input.content);
    const ref: MemoryRef = {
      schema_version: 1,
      tenant_id: input.tenant_id,
      workspace_id: input.workspace_id,
      project_id: input.project_id,
      page_ref,
      revision: 1,
      hash: `sha256:${simpleHash(content)}`,
      source_refs: [{ type: 'ai-memory', id: page_ref }],
      trace_id: input.trace_id,
    };
    this.pages.set(page_ref, { ref, content });
    return ref;
  }

  async recall(input: MemoryScope & { query: string; trace_id: string }): Promise<MemoryHit[]> {
    const query = input.query.toLowerCase();
    return [...this.pages.values()]
      .filter(
        ({ ref, content }) =>
          ref.tenant_id === input.tenant_id &&
          ref.workspace_id === input.workspace_id &&
          ref.project_id === input.project_id &&
          content.toLowerCase().includes(query),
      )
      .map(({ ref, content }) => ({ ...ref, snippet: content.slice(0, 240), rank: 1 }));
  }

  async consolidate(
    input: MemoryScope & { page_ref: string; expected_revision: number; trace_id: string },
  ): Promise<MemoryRef> {
    const page = this.get(input.page_ref, input);
    if (page.ref.revision !== input.expected_revision) {
      throw new ContractError('MEMORY_REVISION_CONFLICT', 'Memory revision does not match', {
        page_ref: input.page_ref,
        expected_revision: input.expected_revision,
        current_revision: page.ref.revision,
        trace_id: input.trace_id,
        retryable: false,
      });
    }
    page.ref = { ...page.ref, revision: page.ref.revision + 1, trace_id: input.trace_id };
    return { ...page.ref };
  }

  async read_page(page_ref: string, scope: MemoryScope, trace_id: string): Promise<MemoryRef> {
    const page = this.get(page_ref, scope);
    return { ...page.ref, trace_id };
  }

  async restore_page(page_ref: string, scope: MemoryScope, trace_id: string): Promise<MemoryRef> {
    return this.read_page(page_ref, scope, trace_id);
  }

  getContent(page_ref: string): string | undefined {
    return this.pages.get(page_ref)?.content;
  }

  private get(page_ref: string, scope: MemoryScope): StoredPage {
    const page = this.pages.get(page_ref);
    if (
      !page ||
      page.ref.tenant_id !== scope.tenant_id ||
      page.ref.workspace_id !== scope.workspace_id ||
      page.ref.project_id !== scope.project_id
    ) {
      throw new ContractError(
        'MEMORY_PAGE_NOT_FOUND',
        'Memory page is not available in this scope',
        {
          page_ref,
          trace_id: 'trace_memory_unknown',
          retryable: false,
        },
      );
    }
    return page;
  }
}

export class MemoryServiceAdapter {
  private readonly handoffs = new Map<string, { page_ref: string; claimed_by?: string }>();

  constructor(
    private readonly provider: MemoryProvider,
    private readonly enabled = true,
  ) {}

  health(): {
    service: 'memory-adapter';
    version: '0.1.0';
    status: 'ok' | 'degraded';
    ready: boolean;
  } {
    return {
      service: 'memory-adapter',
      version: '0.1.0',
      status: this.enabled ? 'ok' : 'degraded',
      ready: this.enabled,
    };
  }

  async capture(input: MemoryScope & { content: string; trace_id: string }): Promise<MemoryRef> {
    this.ensureEnabled(input.trace_id);
    return this.provider.capture(input);
  }

  async recall(input: MemoryScope & { query: string; trace_id: string }): Promise<MemoryHit[]> {
    this.ensureEnabled(input.trace_id);
    return this.provider.recall(input);
  }

  async create_handoff(
    page_ref: string,
    scope: MemoryScope,
    trace_id: string,
  ): Promise<{ schema_version: 1; handoff_ref: string; page_ref: string; trace_id: string }> {
    this.ensureEnabled(trace_id);
    await this.provider.read_page(page_ref, scope, trace_id);
    const handoff_ref = `handoff://${createUlid()}`;
    this.handoffs.set(handoff_ref, { page_ref });
    return { schema_version: 1, handoff_ref, page_ref, trace_id };
  }

  async consolidate(
    input: MemoryScope & { page_ref: string; expected_revision: number; trace_id: string },
  ): Promise<MemoryRef> {
    this.ensureEnabled(input.trace_id);
    return this.provider.consolidate(input);
  }

  async read_page(page_ref: string, scope: MemoryScope, trace_id: string): Promise<MemoryRef> {
    this.ensureEnabled(trace_id);
    return this.provider.read_page(page_ref, scope, trace_id);
  }

  async claim_handoff(
    handoff_ref: string,
    client_id: string,
  ): Promise<{ schema_version: 1; status: 'claimed' | 'already_claimed'; page_ref: string }> {
    const handoff = this.handoffs.get(handoff_ref);
    if (!handoff)
      throw new ContractError('HANDOFF_NOT_FOUND', 'Handoff does not exist', {
        trace_id: 'trace_handoff_unknown',
        retryable: false,
      });
    if (handoff.claimed_by)
      return { schema_version: 1, status: 'already_claimed', page_ref: handoff.page_ref };
    handoff.claimed_by = client_id;
    return { schema_version: 1, status: 'claimed', page_ref: handoff.page_ref };
  }

  async restore_page(page_ref: string, scope: MemoryScope, trace_id: string): Promise<MemoryRef> {
    this.ensureEnabled(trace_id);
    return this.provider.restore_page(page_ref, scope, trace_id);
  }

  private ensureEnabled(trace_id: string): void {
    if (!this.enabled)
      throw new ContractError('MEMORY_PROVIDER_OFF', 'ai-memory provider is disabled', {
        trace_id,
        retryable: true,
      });
  }
}

function sanitize(content: string): string {
  return content.replace(/<system>[\s\S]*?<\/system>/gi, '[redacted instruction]');
}

function simpleHash(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
