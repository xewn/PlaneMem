'use client';

import { createHistoryChangeChannel as createScopedHistoryChangeChannel } from '../sync/history-change-channel';
import { proposalOriginalStoragePrefix } from './original-model';

/** Preserve the existing proposal scope and per-store transport. */
export function createHistoryChangeChannel(channelName: string, kind: string) {
  return createScopedHistoryChangeChannel(channelName, kind, proposalOriginalStoragePrefix);
}
