'use server';

import { revalidatePath } from 'next/cache';
import {
  isSyncIdentifier,
  parseContextPackCompileParameters,
  validateIdempotencyKey,
} from '@planemem/contracts';
import {
  ContextPackSaveError,
  compileWorkbenchContextPack,
  getWorkbenchContextPackSaveBinding,
} from '../../lib/context-pack-compile-server';
import { decodePackSaveOriginal, encodePackSaveOriginal } from './save-model';

function field(data: FormData, name: string): string {
  const values = data.getAll(name);
  if (values.length !== 1 || typeof values[0] !== 'string' || values[0].length > 8192)
    throw new TypeError();
  return values[0];
}

export async function preparePackSave(data: FormData) {
  try {
    if (Array.from(data.keys()).some((key) => !['key', 'budget', 'ttl'].includes(key)))
      throw new TypeError();
    const key = validateIdempotencyKey(field(data, 'key'));
    if (!isSyncIdentifier(key) || /\u007f/.test(key)) throw new TypeError();
    const parameters = parseContextPackCompileParameters({
      budget_tokens: Number(field(data, 'budget')),
      ttl_seconds: Number(field(data, 'ttl')),
    });
    const { binding } = await getWorkbenchContextPackSaveBinding();
    return {
      status: 'prepared' as const,
      original: encodePackSaveOriginal({
        schema_version: 1,
        kind: 'context-pack-save',
        binding,
        request_key: key,
        parameters,
      }),
    };
  } catch {
    return {
      status: 'error' as const,
      message:
        'The request could not be prepared. Check the settings and sign in to the intended project. No pack save was sent.',
    };
  }
}

export async function submitPackSave(data: FormData) {
  let original: string | undefined;
  try {
    if (
      Array.from(data.keys()).some((key) => !['original', 'confirmed'].includes(key)) ||
      field(data, 'confirmed') !== 'yes'
    )
      throw new TypeError();
    const request = decodePackSaveOriginal(field(data, 'original'));
    original = encodePackSaveOriginal(request);
    const result = await compileWorkbenchContextPack(
      request.parameters.budget_tokens,
      request.parameters.ttl_seconds,
      request.request_key,
      request.binding,
    );
    try {
      revalidatePath('/context');
    } catch {
      /* A cache failure does not undo a verified save. */
    }
    return {
      status: 'saved' as const,
      original,
      pack_id: result.data.pack_id,
      version: result.data.version,
      trace: result.trace_id,
    };
  } catch (error) {
    const unusable =
      error instanceof ContextPackSaveError &&
      error.dispatched &&
      ((error.status === 409 && error.envelope.code === 'CONTEXT_PACK_STALE') ||
        (error.status === 410 && error.envelope.code === 'CONTEXT_PACK_EXPIRED'));
    return {
      status: 'unknown' as const,
      original,
      unusable,
      message: unusable
        ? 'The original pack is expired or its sources changed. Keep this request; you may explicitly prepare a separate fresh request.'
        : 'The original save is not confirmed. Keep this request unchanged and restore its gateway, account, client, project and permissions before retrying.',
      trace: error instanceof ContextPackSaveError ? error.envelope.trace_id : undefined,
    };
  }
}
