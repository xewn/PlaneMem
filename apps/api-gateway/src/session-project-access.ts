import { ContractError } from '@planemem/contracts';
import type { RuntimeSql } from './runtime-persistence.js';

interface ProjectScope {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
}

/** Embed in the same statement as scoped session data, never use as a cached permission. */
export function visibleSessionProject(
  db: RuntimeSql,
  scope: ProjectScope,
  readRestricted: boolean,
) {
  return db`EXISTS (SELECT 1 FROM wcp_projects p
    WHERE p.id = ${scope.project_id} AND p.tenant_id = ${scope.tenant_id} AND p.workspace_id = ${scope.workspace_id}
      AND p.deleted_at IS NULL AND p.classification IN ('public', 'internal', 'confidential', 'restricted')
      AND (${readRestricted === true} OR p.classification <> 'restricted'))`;
}

/** Call inside the owning write transaction, before locks on child records or receipt replay. */
export async function lockSessionProject(
  tx: RuntimeSql,
  input: ProjectScope & { trace_id: string; read_restricted?: boolean },
): Promise<void> {
  const [project] = await tx<{ id: string }[]>`SELECT id FROM wcp_projects
    WHERE id = ${input.project_id} AND tenant_id = ${input.tenant_id} AND workspace_id = ${input.workspace_id}
      AND deleted_at IS NULL AND classification IN ('public', 'internal', 'confidential', 'restricted')
      AND (${input.read_restricted === true} OR classification <> 'restricted') FOR SHARE`;
  if (!project)
    throw new ContractError('SESSION_NOT_FOUND', 'Session is unavailable in this project', {
      trace_id: input.trace_id,
    });
}
