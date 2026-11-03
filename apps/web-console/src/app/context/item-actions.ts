'use server';

import {
  isSyncIdentifier,
  isUlid,
  parseCreateContextItem,
  parseUpdateContextItem,
  parseConfirmContextItem,
} from '@planemem/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { field } from '../../lib/command-feedback';
import {
  AuthRequiredError,
  WorkbenchApiError,
  createWorkbenchContextItem,
  updateWorkbenchContextItem,
  archiveWorkbenchContextItem,
  restoreWorkbenchContextItem,
  confirmWorkbenchContextItem,
} from '../../lib/server-api';

export interface ItemFeedback {
  status: 'idle' | 'error';
  key?: string;
  message?: string;
  trace?: string | undefined;
  uncertain?: boolean;
  reload?: boolean;
}

export async function saveContextItem(
  previous: ItemFeedback,
  data: FormData,
): Promise<ItemFeedback> {
  const key = field(data, 'key');
  const unresolved = previous.key === key && previous.uncertain === true;
  const id = field(data, 'item_id');
  const version = Number(field(data, 'version'));
  const operation = field(data, 'operation');
  if (
    !key ||
    !['create', 'update', 'archive', 'restore', 'confirm'].includes(operation) ||
    (['archive', 'restore', 'confirm'].includes(operation) &&
      field(data, 'acknowledged') !== 'yes') ||
    (operation !== 'create' && (!id || !Number.isSafeInteger(version) || version < 1))
  )
    return {
      status: 'error',
      key,
      uncertain: unresolved,
      message: 'The item or request version is missing. Reload this page.',
    };
  let input;
  try {
    input =
      operation === 'archive' || operation === 'restore'
        ? undefined
        : operation === 'confirm'
          ? parseConfirmContextItem({ reason: field(data, 'reason') })
          : operation === 'create'
            ? parseCreateContextItem(JSON.parse(field(data, 'draft')))
            : parseUpdateContextItem(JSON.parse(field(data, 'draft')));
  } catch (error) {
    return {
      status: 'error',
      key,
      uncertain: unresolved,
      message: error instanceof Error ? error.message : 'Check the item fields.',
    };
  }
  let itemId: string;
  try {
    const result =
      operation === 'confirm'
        ? await confirmWorkbenchContextItem(id, version, (input as { reason: string }).reason, key)
        : operation === 'restore'
          ? await restoreWorkbenchContextItem(id, version, key)
          : operation === 'archive'
            ? await archiveWorkbenchContextItem(id, version, key)
            : operation === 'create'
              ? await createWorkbenchContextItem(
                  input as ReturnType<typeof parseCreateContextItem>,
                  key,
                )
              : await updateWorkbenchContextItem(
                  id,
                  input as ReturnType<typeof parseUpdateContextItem>,
                  version,
                  key,
                );
    itemId = result.data.item_id;
    if (
      !isSyncIdentifier(itemId) ||
      result.data.operation !== operation ||
      (operation !== 'create' && itemId !== id) ||
      result.data.version !== (operation === 'create' ? 1 : version + 1) ||
      !isUlid(result.data.event_id) ||
      typeof result.data.replayed !== 'boolean' ||
      typeof result.data.occurred_at !== 'string' ||
      !Number.isFinite(Date.parse(result.data.occurred_at))
    )
      throw new Error('The gateway returned an invalid context item receipt');
    revalidatePath('/context');
  } catch (error) {
    if (error instanceof AuthRequiredError)
      return { status: 'error', key, uncertain: unresolved, message: 'Sign in again to continue.' };
    if (error instanceof WorkbenchApiError)
      return {
        status: 'error',
        key,
        message: error.message,
        trace: error.trace_id,
        uncertain: unresolved || error.status === undefined || error.status >= 500,
        reload:
          !unresolved && (error.status === 404 || error.status === 409 || error.status === 410),
      };
    return {
      status: 'error',
      key,
      uncertain: true,
      message: 'The gateway did not confirm this operation. Retry with the original values.',
    };
  }
  redirect(
    '/context?' +
      (operation === 'archive' ? 'view=archived&' : '') +
      'item=' +
      encodeURIComponent(itemId),
  );
}
