'use client';

import { createHistoryChangeChannel } from './history-change-channel';

const changes = createHistoryChangeChannel(
  'planemem-proposal-review-history-changes-v1',
  'review-history-may-have-changed',
);

export const subscribeReviewHistoryChanges = changes.subscribe;
export const withReviewHistoryChange = changes.withChange;
