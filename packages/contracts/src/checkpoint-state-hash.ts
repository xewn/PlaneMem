import type { CheckpointContent } from './checkpoint-clients.js';

/** Preserve the existing checkpoint summary format; this is not cryptographic SHA-256. */
export function checkpointStateHash(
  input: CheckpointContent & {
    context_pack_hash?: string;
    context_pack_id?: string;
    memory_page_ref?: string;
  },
): string {
  const value = JSON.stringify({
    completed: input.completed,
    in_progress: input.in_progress,
    next_actions: input.next_actions,
    decisions: input.decisions,
    risks: input.risks,
    open_questions: input.open_questions,
    context_pack_hash: input.context_pack_hash,
    ...(input.context_pack_id === undefined ? {} : { context_pack_id: input.context_pack_id }),
    memory_page_ref: input.memory_page_ref,
  });
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `sha256:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
