export const CHECKPOINT_DETAIL_RESPONSE_BYTES = 2 * 1024 * 1024;
export const CHECKPOINT_HISTORY_RESPONSE_BYTES = 8 * 1024 * 1024;
export const CHECKPOINT_READ_ERROR_BYTES = 16 * 1024;
/** Reserve space for verified scope, trace, sources and workbench identity metadata. */
export const CHECKPOINT_READ_METADATA_BYTES = 16 * 1024;

export class CheckpointReadLimitError extends TypeError {
  constructor() {
    super('Checkpoint content exceeds the complete read response limit');
    this.name = 'CheckpointReadLimitError';
  }
}

/** Parsed custom transports must obey the same limit as bounded network responses. */
export function assertCheckpointReadBytes(value: unknown, maximum: number): void {
  const raw = JSON.stringify(value);
  if (raw === undefined) throw new TypeError('Expected checkpoint JSON');
  if (new TextEncoder().encode(raw).byteLength > maximum) throw new CheckpointReadLimitError();
}
