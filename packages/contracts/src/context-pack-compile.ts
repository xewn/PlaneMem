import { parseContextPackReadEnvelope, type ContextPackReadEnvelope } from './context-pack-read.js';
import { syncJsonSnapshot } from './sync-upload-receipt.js';

export const CONTEXT_PACK_COMPILE_REQUEST_BYTES = 4096;

/** Explicit values used for the original save and any deliberate same-key retry. */
export interface ContextPackCompileParameters {
  budget_tokens: number;
  ttl_seconds: number;
}

export function parseContextPackCompileParameters(input: unknown): ContextPackCompileParameters {
  const value: unknown = JSON.parse(syncJsonSnapshot(input, CONTEXT_PACK_COMPILE_REQUEST_BYTES));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Supply saved pack compilation parameters');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !['budget_tokens', 'ttl_seconds'].includes(key)))
    throw new TypeError('Only budget_tokens and ttl_seconds are compilation parameters');
  const budget = row.budget_tokens === undefined ? 4096 : row.budget_tokens;
  const ttl = row.ttl_seconds === undefined ? 3600 : row.ttl_seconds;
  if (
    typeof budget !== 'number' ||
    !Number.isSafeInteger(budget) ||
    budget < 128 ||
    budget > 32768 ||
    typeof ttl !== 'number' ||
    !Number.isSafeInteger(ttl) ||
    ttl < 60 ||
    ttl > 86400
  )
    throw new TypeError('Choose a budget of 128–32768 and a lifetime of 60–86400 seconds');
  return { budget_tokens: budget, ttl_seconds: ttl };
}

/** Structure/request parameters only; callers must separately verify the saved content digest. */
export function parseContextPackCompileEnvelope(
  input: unknown,
  original: ContextPackCompileParameters,
  scope: { tenant_id: string; workspace_id: string; project_id: string },
  trace: string,
): ContextPackReadEnvelope {
  const parameters = parseContextPackCompileParameters(original);
  const result = parseContextPackReadEnvelope(input, { format: 'json' }, scope, trace);
  const saved = result.data;
  if (
    saved.pack.budget_tokens !== parameters.budget_tokens ||
    Date.parse(saved.pack.expires_at) - Date.parse(saved.created_at) > parameters.ttl_seconds * 1000
  )
    throw new TypeError('Saved pack differs from the original budget or maximum lifetime');
  // Sources may shorten the lifetime; a replay retains the original creation time and saved trace.
  // The wire receipt does not echo the request key or requested TTL, so this is not key attribution.
  return result;
}
