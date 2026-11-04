import {
  isSyncIdentifier,
  validateIdempotencyKey,
  parsePackSaveBinding,
  parsePackSaveOriginal,
  type PackSaveBinding,
  type PackSaveOriginal,
} from '@planemem/contracts';

export {
  PACK_ORIGINAL_BYTES,
  packGateway,
  parsePackSaveBinding,
  assertPackSaveBinding,
  parsePackSaveOriginal,
  encodePackSaveOriginal,
  decodePackSaveOriginal,
  type PackSaveBinding,
  type PackSaveOriginal,
} from '@planemem/contracts';

// Keep the existing browser slot names and canonical binding order unchanged.
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
