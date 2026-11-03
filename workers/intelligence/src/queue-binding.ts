import { isUlid } from '@planemem/contracts';

export interface ProposalQueueBinding {
  gateway_url: string;
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  actor_id: string;
  client_id: string;
}

export function normalizeQueueBinding(input: ProposalQueueBinding): ProposalQueueBinding {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          'gateway_url',
          'tenant_id',
          'workspace_id',
          'project_id',
          'actor_id',
          'client_id',
        ].includes(key),
    )
  )
    throw new TypeError(
      'Queue binding must contain only gateway, project scope and identity fields',
    );
  const url = new URL(input.gateway_url);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new TypeError('gateway_url must be an HTTP(S) origin without credentials or a path');
  for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
    if (!isUlid(input[field])) throw new TypeError(field + ' must be a ULID');
  for (const field of ['actor_id', 'client_id'] as const)
    if (typeof input[field] !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(input[field]))
      throw new TypeError(field + ' must contain 1-255 visible ASCII characters');
  return {
    gateway_url: url.origin,
    tenant_id: input.tenant_id,
    workspace_id: input.workspace_id,
    project_id: input.project_id,
    actor_id: input.actor_id,
    client_id: input.client_id,
  };
}
