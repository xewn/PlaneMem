import {
  isSyncIdentifier,
  isUlid,
  parseSyncCommandIdentity,
  parseContextPackCompileParameters,
  syncJsonSnapshot,
  validateIdempotencyKey,
  type ContextPackSaveIdentity,
  type ContextPackCompileParameters,
} from '@planemem/contracts';

export const PACK_ORIGINAL_BYTES = 8192;
export interface PackSaveBinding {
  gateway_url: string;
  identity: ContextPackSaveIdentity;
  read_restricted: boolean;
}
export interface PackSaveOriginal {
  schema_version: 1;
  kind: 'context-pack-save';
  binding: PackSaveBinding;
  request_key: string;
  parameters: ContextPackCompileParameters;
}
function object(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new TypeError();
  return row;
}
export function packGateway(value: string): string {
  if (value.length > 4096 || value !== value.trim()) throw new TypeError();
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new TypeError();
  return url.href.replace(/\/+$/, '');
}
export function parsePackSaveBinding(input: unknown): PackSaveBinding {
  const row = object(JSON.parse(syncJsonSnapshot(input, PACK_ORIGINAL_BYTES)), [
    'gateway_url',
    'identity',
    'read_restricted',
  ]);
  if (
    typeof row.gateway_url !== 'string' ||
    packGateway(row.gateway_url) !== row.gateway_url ||
    typeof row.read_restricted !== 'boolean'
  )
    throw new TypeError();
  const identity = parseSyncCommandIdentity(row.identity);
  if (
    ![identity.tenant_id, identity.workspace_id, identity.project_id, identity.actor_id].every(
      isUlid,
    ) ||
    !isSyncIdentifier(identity.client_id) ||
    /\u007f/.test(identity.client_id)
  )
    throw new TypeError();
  return { gateway_url: row.gateway_url, identity, read_restricted: row.read_restricted };
}
export function assertPackSaveBinding(actual: unknown, expected: unknown) {
  if (
    JSON.stringify(parsePackSaveBinding(actual)) !== JSON.stringify(parsePackSaveBinding(expected))
  )
    throw new TypeError('Restore the original gateway, project, account, client and permissions');
}
export function parsePackSaveOriginal(input: unknown): PackSaveOriginal {
  const row = object(JSON.parse(syncJsonSnapshot(input, PACK_ORIGINAL_BYTES)), [
    'schema_version',
    'kind',
    'binding',
    'request_key',
    'parameters',
  ]);
  if (row.schema_version !== 1 || row.kind !== 'context-pack-save') throw new TypeError();
  const key = validateIdempotencyKey(row.request_key);
  if (!isSyncIdentifier(key) || /\u007f/.test(key)) throw new TypeError();
  const parameters = parseContextPackCompileParameters(
    object(row.parameters, ['budget_tokens', 'ttl_seconds']),
  );
  return {
    schema_version: 1,
    kind: 'context-pack-save',
    binding: parsePackSaveBinding(row.binding),
    request_key: key,
    parameters,
  };
}
export function encodePackSaveOriginal(input: unknown): string {
  return syncJsonSnapshot(parsePackSaveOriginal(input), PACK_ORIGINAL_BYTES);
}
export function decodePackSaveOriginal(raw: unknown): PackSaveOriginal {
  if (
    typeof raw !== 'string' ||
    raw.length > PACK_ORIGINAL_BYTES ||
    new TextEncoder().encode(raw).byteLength > PACK_ORIGINAL_BYTES
  )
    throw new TypeError();
  return parsePackSaveOriginal(JSON.parse(raw.replace(/^\uFEFF/, '')));
}
export function packOriginalPrefix(binding: PackSaveBinding) {
  return (
    'planemem:pack-save:v1:' + JSON.stringify([parsePackSaveBinding(binding)]).slice(0, -1) + ','
  );
}
export function packOriginalKey(original: PackSaveOriginal) {
  const value = parsePackSaveOriginal(original);
  return packOriginalSlot(value.binding, value.request_key);
}
export function packOriginalSlot(binding: PackSaveBinding, requestKey: string) {
  const key = validateIdempotencyKey(requestKey);
  if (!isSyncIdentifier(key) || /\u007f/.test(key)) throw new TypeError();
  return packOriginalPrefix(binding) + JSON.stringify(key) + ']';
}
