// Keep existing browser imports and the on-disk format stable.
export {
  PACK_RECEIPT_MAX_VOLUMES,
  PACK_RECEIPT_VOLUMES_MAX_ENTRIES,
  PACK_RECEIPT_VOLUMES_DOCUMENT_BYTES,
  PACK_RECEIPT_VOLUMES_FILE_BYTES,
  PACK_RECEIPT_VOLUMES_SET_BYTES,
  parsePackReceiptVolumesDocument,
  packReceiptVolumesDocumentJson,
  parsePackReceiptVolumesFile,
  packReceiptVolumesFileJson,
  type PackReceiptVolumesDocument,
  type PackReceiptVolumesFile,
  type PackReceiptVolumesCandidate,
} from '@planemem/contracts';
