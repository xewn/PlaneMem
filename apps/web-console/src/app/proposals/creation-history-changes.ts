'use client';

import { createHistoryChangeChannel } from './history-change-channel';

const changes = createHistoryChangeChannel(
  'planemem-proposal-creation-history-changes-v1',
  'creation-history-may-have-changed',
);

export const subscribeCreationHistoryChanges = changes.subscribe;
export const withCreationHistoryChange = changes.withChange;
