import { parseIndexedContextInput, type IndexedContextInput } from './legacy-search.js';
import {
  parseLegacyContextIdentity,
  type LegacyContextIdentity,
} from './legacy-context-lifecycle.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';
import type { SourceRef } from './metadata.js';

export const LEGACY_INDEX_INPUT_BYTES = 1024 * 1024;
export const LEGACY_INDEX_RESPONSE_BYTES = 2 * 1024 * 1024;
export type IndexedContextWriteRequest = Omit<
  IndexedContextInput,
  'classification' | 'rank_source' | 'expires_at'
> &
  Partial<Pick<IndexedContextInput, 'classification' | 'rank_source' | 'expires_at'>>;
export type IndexedContextRecord = IndexedContextInput &
  Pick<LegacyContextIdentity, 'tenant_id' | 'workspace_id' | 'project_id'> & { schema_version: 1 };
export interface IndexedContextWriteEnvelope {
  schema_version: 1;
  trace_id: string;
  source_refs: SourceRef[];
  data: IndexedContextRecord;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected index data');
  return value as Record<string, unknown>;
}
/** Detached normalized manual input. Plane IDs remain owned by event projection. */
export function parseIndexedContextWriteInput(value: unknown): IndexedContextInput {
  const input = parseIndexedContextInput(
    JSON.parse(syncJsonSnapshot(value, LEGACY_INDEX_INPUT_BYTES)),
  );
  if (input.id.startsWith('plane:')) throw new TypeError('Plane index IDs are managed by events');
  syncJsonSnapshot(input, LEGACY_INDEX_INPUT_BYTES);
  return input;
}
/** Match the complete original body; only one optional capture reference may be appended. */
export function parseIndexedContextWriteEnvelope(
  value: unknown,
  input: IndexedContextInput,
  scope: Pick<LegacyContextIdentity, 'tenant_id' | 'workspace_id' | 'project_id'>,
  trace: string,
): IndexedContextWriteEnvelope {
  const expected = parseIndexedContextWriteInput(input);
  const identity = parseLegacyContextIdentity({ ...scope, actor_id: 'mock', client_id: 'mock' });
  const envelope = object(JSON.parse(syncJsonSnapshot(value, LEGACY_INDEX_RESPONSE_BYTES)));
  if (
    typeof trace !== 'string' ||
    !trace.trim() ||
    trace.length > 1024 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(trace) ||
    envelope.schema_version !== 1 ||
    envelope.trace_id !== trace ||
    !Array.isArray(envelope.source_refs)
  )
    throw new TypeError('Index envelope does not match the request');
  const { schema_version, tenant_id, workspace_id, project_id, ...body } = object(envelope.data);
  if (
    schema_version !== 1 ||
    tenant_id !== identity.tenant_id ||
    workspace_id !== identity.workspace_id ||
    project_id !== identity.project_id
  )
    throw new TypeError('Index scope does not match the request');
  if (Object.keys(expected).some((key) => !Object.hasOwn(body, key)))
    throw new TypeError('Index receipt is missing normalized content fields');
  const parsed = parseIndexedContextInput(body);
  const sources = parseIndexedContextInput({
    ...expected,
    source_refs: envelope.source_refs,
  }).source_refs;
  const appended = parsed.source_refs.slice(expected.source_refs.length);
  const original = {
    ...parsed,
    source_refs: parsed.source_refs.slice(0, expected.source_refs.length),
  };
  if (
    JSON.stringify(original) !== JSON.stringify(expected) ||
    appended.length > 1 ||
    appended.some(
      (ref) => ref.type !== 'ai-memory' || ref.revision !== undefined || ref.uri !== undefined,
    ) ||
    JSON.stringify(sources) !== JSON.stringify(parsed.source_refs)
  )
    throw new TypeError('Index receipt content or sources differ from the original request');
  return {
    schema_version: 1,
    trace_id: trace,
    source_refs: sources,
    data: {
      ...parsed,
      schema_version: 1,
      tenant_id: identity.tenant_id,
      workspace_id: identity.workspace_id,
      project_id: identity.project_id,
    },
  };
}
