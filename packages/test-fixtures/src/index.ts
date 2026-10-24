import {
  ContractError,
  createUlid,
  type ProjectEntity,
  type TenantEntity,
  type Ulid,
  validateEntity,
} from '@planemem/contracts';
import { validateEvent, type CanonicalEvent } from '@planemem/events';

export const FIXTURE_VERSION = '0.1.0';

const fixtureUlid = (value: string): Ulid => value as Ulid;
const IDS = {
  tenant: fixtureUlid('01HF7YAT000000000000000001'),
  workspace: fixtureUlid('01HF7YAT000000000000000002'),
  project: fixtureUlid('01HF7YAT000000000000000003'),
  workItem: fixtureUlid('01HF7YAT000000000000000004'),
  session: fixtureUlid('01HF7YAT000000000000000005'),
  checkpoint: fixtureUlid('01HF7YAT000000000000000006'),
  actor: fixtureUlid('01HF7YAT000000000000000007'),
  event: fixtureUlid('01HF7YAT000000000000000008'),
} as const;

function baseMetadata(id: Ulid, trace_id: string, projectScoped = true) {
  return {
    schema_version: 1 as const,
    id,
    tenant_id: IDS.tenant,
    workspace_id: IDS.workspace,
    ...(projectScoped ? { project_id: IDS.project } : {}),
    version: 1,
    etag: 'W/"version-1"',
    source_refs: [{ type: 'fixture', id: `p0-fixture-${id.slice(-6)}` }],
    classification: 'internal' as const,
    created_at: '2026-10-20T08:00:00.000Z',
    updated_at: '2026-10-20T08:00:00.000Z',
    trace_id,
  };
}

export function createTestTenant(seed = 'demo'): TenantEntity {
  const id: Ulid = seed === 'demo' ? IDS.tenant : createUlid(1_700_000_000_100);
  return {
    ...baseMetadata(id, `trace_fixture_${seed}`, false),
    name: `tenant-${seed}`,
    status: 'active',
  } as TenantEntity;
}

export function createTestProject(seed = 'demo'): ProjectEntity {
  return {
    ...baseMetadata(IDS.project, `trace_fixture_${seed}`),
    project_id: IDS.project,
    title: `Continuity project ${seed}`,
    status: 'active',
    external_id: `fixture-${seed}-project`,
  };
}

export function mockPlaneEvent(seed = 'demo'): CanonicalEvent<Record<string, unknown>> {
  return {
    event_id: IDS.event,
    event_type: 'ProjectCreated',
    schema_version: 1,
    tenant_id: IDS.tenant,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    aggregate_type: 'project',
    aggregate_id: IDS.project,
    aggregate_version: 1,
    actor_id: IDS.actor,
    client_id: 'plane-fixture',
    occurred_at: '2026-10-20T08:00:00.000Z',
    trace_id: `trace_fixture_${seed}`,
    source_refs: [{ type: 'plane', id: `project-${seed}` }],
    sensitivity: 'internal',
    payload: {
      id: IDS.project,
      external_id: `fixture-${seed}-project`,
      title: `Continuity project ${seed}`,
      status: 'active',
    },
  };
}

export function mockMemoryPage(seed = 'demo') {
  return {
    fixture_version: FIXTURE_VERSION,
    page_ref: `memory://tenant-demo/workspace-demo/project-continuity/${seed}`,
    revision: 1,
    hash: `sha256:fixture-${seed}-memory`,
    title: `Memory page ${seed}`,
    content: `Synthetic memory content for ${seed}.`,
    source_refs: [{ type: 'ai-memory', id: `page-${seed}` }],
    classification: 'internal' as const,
    trace_id: `trace_fixture_${seed}`,
  };
}

export function assertContract<T>(kind: 'event' | 'memory_page' | string, value: T): T {
  if (kind === 'event') {
    const result = validateEvent(value);
    if (!result.valid) {
      throw new ContractError(result.error.code, result.error.message, {
        ...result.error.details,
        trace_id: result.error.trace_id,
        retryable: result.error.retryable,
      });
    }
    return value;
  }
  if (kind === 'memory_page') {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('page_ref' in value) ||
      !('revision' in value) ||
      !('hash' in value)
    ) {
      throw new ContractError('FIXTURE_CONTRACT_INVALID', 'Memory page fixture is invalid', {
        trace_id: 'trace_unknown',
        retryable: false,
      });
    }
    return value;
  }
  const result = validateEntity(kind, value);
  if (!result.valid) {
    throw new ContractError(result.error.code, result.error.message, {
      ...result.error.details,
      trace_id: result.error.trace_id,
      retryable: result.error.retryable,
    });
  }
  return value;
}
