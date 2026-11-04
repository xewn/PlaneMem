'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  ContextPackSaveError,
  compileWorkbenchContextPack,
} from '../../lib/context-pack-compile-server';

export interface PackFeedback {
  status: 'idle' | 'error';
  key?: string;
  message?: string;
  trace?: string | undefined;
  uncertain?: boolean;
  unusable?: boolean;
}

export async function compilePack(previous: PackFeedback, data: FormData): Promise<PackFeedback> {
  const field = (name: string) => {
    const values = data.getAll(name);
    return values.length === 1 && typeof values[0] === 'string' ? values[0] : '';
  };
  const key = field('key');
  const unresolved = previous.key === key && previous.uncertain === true;
  const budget = Number(field('budget'));
  const ttl = Number(field('ttl'));
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
    packId = result.data.pack_id;
  } catch (error) {
    if (error instanceof ContextPackSaveError) {
      // A verified stale/expired response permits a deliberate new request, but does not
      // turn this invocation's unknown outcome into evidence that no save happened.
      const unusable =
        (error.status === 409 && error.envelope.code === 'CONTEXT_PACK_STALE') ||
        (error.status === 410 && error.envelope.code === 'CONTEXT_PACK_EXPIRED');
      return {
        status: 'error',
        key,
        trace: error.envelope.trace_id,
        message: unusable
          ? 'The gateway reports that the original pack is expired or its sources changed. You may deliberately start a separate fresh request; this does not mean the original save failed.'
          : error.message,
        unusable,
        uncertain: unresolved || error.dispatched,
      };
    }
    return {
      status: 'error',
      key,
      uncertain: true,
      message: 'The gateway did not confirm the saved pack. Retry with the original settings.',
    };
  }
  try {
    revalidatePath('/context');
  } catch {
    // Cache refresh failure must not ask the user to resubmit an already verified save.
  }
  redirect('/context?pack=' + encodeURIComponent(packId));
}
