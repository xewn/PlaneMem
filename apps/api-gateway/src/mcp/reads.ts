import { ContractError, isSyncIdentifier, isUlid } from '@planemem/contracts';
import type { PlaneProjection } from '@planemem/plane-connector';
import type { PostgresLegacySearch } from '@planemem/search-service';
import type { CommandRouter } from '../router.js';
import type { WorkbenchDatabase, WorkbenchRepository } from '../workbench/repository.js';
import { McpResourceDirectory } from './resource-directory.js';
import { executeResourceDirectory } from './resource-directory-read.js';
import {
  executeContextItemResource,
  isContextItemResourceUri,
  executeContextPackResource,
  isContextPackResourceUri,
} from './context-resource.js';
import {
  listMcpPrompts,
  listMcpTools,
  MCP_RESOURCE_TEMPLATES,
  renderMcpPrompt,
} from './catalog.js';

export interface RuntimeResource {
  uri: string;
  mimeType: string;
  text: string;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  source_refs: Array<{ type: string; id: string }>;
}

export function resourceKey(
  scope: { tenant_id: string; workspace_id: string; project_id: string },
  uri: string,
) {
  return JSON.stringify([scope.tenant_id, scope.workspace_id, scope.project_id, uri]);
}

export function registerMcpReads(
  router: CommandRouter,
  _resources: Map<string, RuntimeResource>,
  workbench: WorkbenchRepository,
  _projection: PlaneProjection,
  legacySearch?: PostgresLegacySearch,
  database?: WorkbenchDatabase,
) {
  const directory = new McpResourceDirectory(database);
  router.register('mcp.catalog', async (request) => {
    const { input, context } = request;
    let data: Record<string, unknown>;
    switch (input.kind) {
      case 'tools':
        data = { tools: listMcpTools(context) };
        break;
      case 'prompts':
        data = { prompts: listMcpPrompts() };
        break;
      case 'templates':
        data = { resourceTemplates: structuredClone(MCP_RESOURCE_TEMPLATES) };
        break;
      case 'resources': {
        return executeResourceDirectory(router, directory, input, context);
      }
      case 'initialize':
      case 'ping':
        data = {};
        break;
      default:
        throw new ContractError('INVALID_INPUT', 'Unknown MCP catalog', {
          trace_id: context.trace_id,
        });
    }
    return {
      schema_version: 1,
      trace_id: context.trace_id,
      source_refs: [{ type: 'mcp', id: 'catalog' }],
      data,
    };
  });

  router.register('mcp.prompt', (request) => {
    const { context, input } = request;
    if (
      typeof input.name !== 'string' ||
      !input.arguments ||
      typeof input.arguments !== 'object' ||
      Array.isArray(input.arguments)
    )
      throw new ContractError('INVALID_INPUT', 'Expected a prompt name and arguments object', {
        trace_id: context.trace_id,
      });
    return {
      schema_version: 1,
      trace_id: context.trace_id,
      source_refs: [{ type: 'mcp-prompt', id: input.name }],
      data: renderMcpPrompt(
        input.name,
        input.arguments as Record<string, unknown>,
        context.trace_id,
      ),
    };
  });

  router.register('mcp.resource', async (request) => {
    const { input, context } = request;
    const uri = input.uri;
    const missing = (): never => {
      throw new ContractError('MCP_RESOURCE_NOT_FOUND', 'MCP resource not found', {
        trace_id: context.trace_id,
      });
    };
    if (typeof uri !== 'string' || !uri) return missing();
    if (uri.startsWith('wcp://context/')) {
      const match = /^wcp:\/\/context\/([^/?#]+)$/.exec(uri);
      if (!match) return missing();
      let id: string;
      try {
        id = decodeURIComponent(match[1]!);
      } catch {
        return missing();
      }
      if (!legacySearch)
        throw new ContractError(
          'SEARCH_STORAGE_UNAVAILABLE',
          'Context resource storage is not configured',
          { trace_id: context.trace_id, retryable: true },
        );
      const hit = await legacySearch.read(
        { ...context, read_restricted: context.capability.includes('data.restricted.read') },
        id,
        context.trace_id,
      );
      if (!hit) return missing();
      return {
        schema_version: 1,
        trace_id: context.trace_id,
        source_refs: hit.source_refs,
        data: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(hit) }] },
      };
    }
    if (!uri.startsWith('work://')) return missing();
    if (isContextItemResourceUri(uri))
      return executeContextItemResource(router, directory, input, context);
    if (isContextPackResourceUri(uri))
      return executeContextPackResource(router, directory, input, context);
    await directory.requireProject(context);
    const savedMatch = /^work:\/\/project\/([^/?#]+)\/(overview|work-item\/([^/?#]+))$/.exec(uri);
    if (savedMatch) {
      let project: string;
      let itemId: string | undefined;
      try {
        project = decodeURIComponent(savedMatch[1]!);
        itemId = savedMatch[3] === undefined ? undefined : decodeURIComponent(savedMatch[3]);
      } catch {
        return missing();
      }
      if (project !== context.project_id) return missing();
      const document = await router.execute({
        operation: 'workbench.query',
        context,
        input:
          itemId === undefined
            ? { operation: 'overview' }
            : { operation: 'work_item', item_id: itemId },
      });
      return {
        schema_version: 1,
        trace_id: context.trace_id,
        source_refs: document.source_refs,
        data: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(document) }] },
      };
    }
    const proposalMatch = /^work:\/\/project\/([^/?#]+)\/proposal\/([^/?#]+)$/.exec(uri);
    if (proposalMatch) {
      let project: string;
      let proposal: string;
      try {
        project = decodeURIComponent(proposalMatch[1]!);
        proposal = decodeURIComponent(proposalMatch[2]!);
      } catch {
        return missing();
      }
      if (project !== context.project_id) return missing();
      const document = await router.execute({
        operation: 'proposal.read',
        context,
        input: { proposal_id: proposal },
      });
      return {
        schema_version: 1,
        trace_id: context.trace_id,
        source_refs: document.source_refs,
        data: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(document) }] },
      };
    }
    const match =
      /^work:\/\/(project|work-item|session)\/([^/?#]+)(?:\/(current-state|context|checkpoint|handoff))?$/.exec(
        uri,
      );
    if (!match) return missing();
    let id: string;
    try {
      id = decodeURIComponent(match[2]!);
    } catch {
      return missing();
    }
    if (!isSyncIdentifier(id) || id === '.' || id === '..') return missing();
    const type = match[1];
    const suffix = match[3];
    let result;
    if (type === 'project' && (suffix === undefined || suffix === 'current-state')) {
      if (id !== context.project_id) return missing();
      result = await router.execute({
        operation: 'project.state',
        input: { project_id: id },
        context,
      });
    } else if (type === 'work-item' && suffix === undefined) {
      result = await router.execute({
        operation: 'workitem.state',
        input: { work_item_id: id },
        context,
      });
    } else if (type === 'work-item' && suffix === 'context') {
      result = await router.execute({
        operation: 'workitem.context',
        input: { work_item_id: id },
        context,
      });
    } else if (type === 'session' && suffix === 'checkpoint') {
      if (!isUlid(id)) return missing();
      let page;
      try {
        page = await workbench.sessionCheckpoints(
          { ...context, read_restricted: context.capability.includes('data.restricted.read') },
          context.trace_id,
          id,
        );
      } catch (error) {
        if (error instanceof ContractError && error.envelope.code === 'SESSION_NOT_FOUND')
          return missing();
        throw error;
      }
      if (!page.data.length) return missing();
      result = {
        schema_version: page.schema_version,
        session_id: page.session_id,
        trace_id: page.trace_id,
        source_refs: page.source_refs,
        data: page.data[0],
      };
    } else if (type === 'session' && suffix === 'handoff') {
      if (!isUlid(id)) return missing();
      const page = await workbench.listHandoffs(
        { ...context, read_restricted: context.capability.includes('data.restricted.read') },
        context.trace_id,
        { session_id: id, limit: 25 },
      );
      const handoffs = page.data;
      if (!handoffs.length) return missing();
      result = {
        ...page,
        data: handoffs,
        ...(page.next_cursor
          ? {
              continuation: {
                tool: 'list_handoffs',
                arguments: { session_id: id, limit: 25, cursor: page.next_cursor },
              },
            }
          : {}),
      };
    } else return missing();
    return {
      schema_version: 1,
      trace_id: context.trace_id,
      source_refs: result.source_refs,
      data: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(result) }] },
    };
  });
}
