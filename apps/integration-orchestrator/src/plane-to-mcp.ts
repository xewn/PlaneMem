import { createUlid, type Ulid } from '@planemem/contracts';
import { ContextSearchService } from '@planemem/context-service';
import { compileContextPack, type ContextPack } from '@planemem/context-compiler';
import { McpGateway, type McpContext } from '@planemem/mcp-gateway';
import { PlaneProjection, type ObservedState } from '@planemem/plane-connector';
import type { CanonicalEvent, EventConsumerResult } from '@planemem/events';
import { CommandRouter } from '@planemem/api-gateway';
import type { IntegrationReport, IntegrationStep } from './runner.js';

export interface PlaneToMcpScenarioInput {
  scope: {
    tenant_id: Ulid;
    workspace_id: Ulid;
    project_id: Ulid;
  };
  trace_id: string;
  external_project_id: string;
  title: string;
}

export interface PlaneToMcpScenarioResult {
  report: IntegrationReport;
  duplicate_event: EventConsumerResult;
  observed_state: ObservedState;
  context_pack: ContextPack;
  mcp_resource: Awaited<ReturnType<McpGateway['readResource']>>;
}

/**
 * Executes the public module boundaries used by the Plane-to-MCP chain.
 *
 * The function deliberately accepts a canonical event instead of touching a
 * Plane database. A real Plane webhook can feed the same event contract in a
 * deployment test, while this deterministic path proves the provider/consumer
 * handoff without bypassing projection, context compilation, or MCP fencing.
 */
export async function runPlaneToMcpScenario(
  input: PlaneToMcpScenarioInput,
): Promise<PlaneToMcpScenarioResult> {
  const started_at = new Date().toISOString();
  const steps: IntegrationStep[] = [];
  const event = createProjectEvent(input);
  const projection = new PlaneProjection();

  await executeStep(steps, input.trace_id, 'plane.webhook', async () => event);
  const applied = await executeStep(steps, input.trace_id, 'projection.apply', async () =>
    projection.applyPlaneEvent(event),
  );
  if (applied.status !== 'accepted' || !applied.effect_applied) {
    throw new Error(`Plane projection did not accept event: ${applied.status}`);
  }
  const duplicate_event = projection.applyPlaneEvent(event);
  if (duplicate_event.status !== 'duplicate' || duplicate_event.effect_applied) {
    throw new Error('Duplicate Plane event changed projection state');
  }
  const observed_state = projection.getObservedState('Project', input.external_project_id);
  if (observed_state === undefined) throw new Error('Projected Plane state is missing');

  const context_pack = await executeStep(steps, input.trace_id, 'context.compile', async () => {
    const pack = compileContextPack(
      {
        scope: input.scope,
        trace_id: input.trace_id,
        items: [
          {
            schema_version: 1,
            id: `plane-project:${input.external_project_id}`,
            layer: 'L1',
            content: `${input.title} is active in Plane (${input.external_project_id}).`,
            source_refs: [{ type: 'plane', id: input.external_project_id }],
            confirmed: true,
            confidence: 1,
            priority: 100,
            sensitivity: 'internal',
            ...input.scope,
            trace_id: input.trace_id,
          },
        ],
      },
      { budget_tokens: 128 },
    );
    return pack;
  });

  const search = new ContextSearchService();
  search.addPack(context_pack);
  const resource_uri = `wcp://context/${context_pack.pack_hash}`;
  const resource = search.getMcpResource(resource_uri, input.scope);
  if (resource === undefined) throw new Error('Context resource failed scope fencing');

  const gateway = new McpGateway(new CommandRouter());
  gateway.registerResource(resource_uri, resource);
  const mcp_context: McpContext = {
    ...input.scope,
    actor_id: 'integration-orchestrator',
    client_id: 'integration-fixture',
    trace_id: input.trace_id,
    capability: ['context.read'],
    schema_version: 1,
    capabilities: { resources: { subscribe: false } },
  };
  const mcp_resource = await executeStep(steps, input.trace_id, 'mcp.resource', () =>
    gateway.readResource(resource_uri, mcp_context),
  );

  return {
    report: {
      schema_version: 1,
      scenario_id: 'plane-to-mcp',
      trace_id: input.trace_id,
      status: 'passed',
      steps,
      faults: [{ name: 'duplicate_event', handled: true, retryable: false }],
      started_at,
      ended_at: new Date().toISOString(),
    },
    duplicate_event,
    observed_state,
    context_pack,
    mcp_resource,
  };
}

function createProjectEvent(input: PlaneToMcpScenarioInput): CanonicalEvent {
  return {
    event_id: createUlid(),
    event_type: 'ProjectCreated',
    schema_version: 1,
    ...input.scope,
    aggregate_type: 'project',
    aggregate_id: input.scope.project_id,
    aggregate_version: 1,
    occurred_at: new Date().toISOString(),
    trace_id: input.trace_id,
    source_refs: [{ type: 'plane', id: input.external_project_id }],
    sensitivity: 'internal',
    payload: {
      external_id: input.external_project_id,
      title: input.title,
      status: 'active',
    },
  };
}

async function executeStep<T>(
  steps: IntegrationStep[],
  trace_id: string,
  name: string,
  action: () => Promise<T> | T,
): Promise<T> {
  try {
    const result = await action();
    steps.push({
      name,
      status: 'passed',
      trace_id,
      source_refs: [{ type: 'integration-step', id: name }],
    });
    return result;
  } catch (error) {
    steps.push({
      name,
      status: 'failed',
      trace_id,
      source_refs: [{ type: 'integration-step', id: name }],
    });
    throw error;
  }
}
