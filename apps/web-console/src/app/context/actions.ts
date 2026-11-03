'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { field } from '../../lib/command-feedback';
import { validatePackReceipt } from '../../lib/mutation-receipts';
import {
  AuthRequiredError,
  WorkbenchApiError,
  compileWorkbenchContextPack,
} from '../../lib/server-api';

export interface PackFeedback {
  status: 'idle' | 'error';
  key?: string;
  message?: string;
  trace?: string | undefined;
  uncertain?: boolean;
  unusable?: boolean;
}

export async function compilePack(previous: PackFeedback, data: FormData): Promise<PackFeedback> {
  const key = field(data, 'key');
  const unresolved = previous.key === key && previous.uncertain === true;
  const budget = Number(field(data, 'budget'));
  const ttl = Number(field(data, 'ttl'));
  if (
    !key ||
    !Number.isSafeInteger(budget) ||
    budget < 128 ||
    budget > 32768 ||
    !Number.isSafeInteger(ttl) ||
    ttl < 60 ||
    ttl > 86400
  )
    return {
      status: 'error',
      key,
      uncertain: unresolved,
      message: 'Choose a budget of 128–32768 and a lifetime of 60–86400 seconds.',
    };
  let packId: string;
  try {
    const result = await compileWorkbenchContextPack(budget, ttl, key);
    validatePackReceipt(result.data, budget, ttl);
    packId = result.data.pack_id;
    revalidatePath('/context');
  } catch (error) {
    if (error instanceof AuthRequiredError)
      return { status: 'error', key, uncertain: unresolved, message: 'Sign in again to continue.' };
    if (error instanceof WorkbenchApiError) {
      // These responses are produced only after finding the original saved pack.
      // Other 4xx responses do not settle a previously unknown write outcome.
      const unusable =
        (error.status === 409 && error.code === 'CONTEXT_PACK_STALE') ||
        (error.status === 410 && error.code === 'CONTEXT_PACK_EXPIRED');
      return {
        status: 'error',
        key,
        trace: error.trace_id,
        message: unusable
          ? 'The original request saved a pack, but that pack is now expired or its sources changed. Start a new request to prepare a fresh pack.'
          : error.message,
        unusable,
        uncertain: !unusable && (unresolved || error.status === undefined || error.status >= 500),
      };
    }
    return {
      status: 'error',
      key,
      uncertain: true,
      message: 'The gateway did not confirm the saved pack. Retry with the original settings.',
    };
  }
  redirect('/context?pack=' + encodeURIComponent(packId));
}
