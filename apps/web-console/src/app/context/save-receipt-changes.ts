'use client';

import { parsePackSaveBinding, type PackSaveBinding } from '@planemem/contracts';
import { createHistoryChangeChannel } from '../sync/history-change-channel';

const changes = createHistoryChangeChannel(
  'planemem-context-pack-save-history-changes-v1',
  'context-pack-save-history-may-have-changed',
  (binding: PackSaveBinding) => JSON.stringify(parsePackSaveBinding(binding)),
);

export const subscribePackReceiptHistoryChanges = changes.subscribe;
export const withPackReceiptHistoryChange = changes.withChange;
