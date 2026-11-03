import {
  parseConflictCommandIdentity,
  type ConflictCommandIdentity,
  type RequestContext,
} from '@planemem/contracts';

/** Scope is always required. Optional SDK hints constrain the original, never supply authenticated identity. */
export function assertConflictClientIdentity(
  original: ConflictCommandIdentity,
  context: RequestContext,
) {
  const identity = parseConflictCommandIdentity(original);
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (identity[field] !== context[field])
      throw new TypeError('Original conflict scope differs from the SDK scope');
  for (const field of ['actor_id', 'client_id'] as const)
    if (context[field] !== undefined && identity[field] !== context[field])
      throw new TypeError('Original conflict identity differs from the SDK constraint');
}
