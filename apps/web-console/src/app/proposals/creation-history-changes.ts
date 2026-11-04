'use client';

import { proposalOriginalStoragePrefix, type ProposalSubmissionBinding } from './original-model';

const channelName = 'planemem-proposal-creation-history-changes-v1';
const listeners = new Map<string, Set<() => void>>();
let channel: BroadcastChannel | undefined;

function scopeKey(binding: ProposalSubmissionBinding) {
  const scope = proposalOriginalStoragePrefix(binding);
  if (new TextEncoder().encode(scope).byteLength > 16384) throw new TypeError();
  return scope;
}
function deliver(scope: string) {
  for (const receive of [...(listeners.get(scope) ?? [])]) {
    try {
      receive();
    } catch {
      // A notification listener cannot change a storage operation's outcome.
    }
  }
}
function connection() {
  if (channel) return channel;
  try {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
    channel = new BroadcastChannel(channelName);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const value = event.data;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const row = value as Record<string, unknown>;
      if (
        Object.keys(row).length !== 3 ||
        !['schema_version', 'kind', 'scope'].every((field) => Object.hasOwn(row, field)) ||
        row.schema_version !== 1 ||
        row.kind !== 'creation-history-may-have-changed' ||
        typeof row.scope !== 'string' ||
        row.scope.length > 16384 ||
        new TextEncoder().encode(row.scope).byteLength > 16384
      )
        return;
      // Scope matches only choose listeners; messages never supply data or authorize an action.
      deliver(row.scope);
    };
    return channel;
  } catch {
    closeConnection();
    return;
  }
}
function closeConnection() {
  const previous = channel;
  channel = undefined;
  try {
    previous?.close();
  } catch {
    // Focus and visibility invalidation remain available when messaging is unavailable.
  }
}
export function subscribeCreationHistoryChanges(
  binding: ProposalSubmissionBinding,
  receive: () => void,
) {
  let scope: string;
  try {
    scope = scopeKey(binding);
  } catch {
    // Keep the page and focus fallback usable even when a scope cannot be subscribed.
    return () => {};
  }
  const scoped = listeners.get(scope) ?? new Set<() => void>();
  scoped.add(receive);
  listeners.set(scope, scoped);
  connection();
  return () => {
    scoped.delete(receive);
    if (!scoped.size && listeners.get(scope) === scoped) listeners.delete(scope);
    if (!listeners.size) closeConnection();
  };
}
function announce(binding: ProposalSubmissionBinding) {
  try {
    const scope = scopeKey(binding);
    deliver(scope);
    connection()?.postMessage({
      schema_version: 1,
      kind: 'creation-history-may-have-changed',
      scope,
    });
  } catch {
    // Messaging is best effort and must never turn a committed write into a reported failure.
  } finally {
    if (!listeners.size) closeConnection();
  }
}
/** Announce attempts and their settlement, including failure/unknown; never claim a commit. */
export async function withCreationHistoryChange<T>(
  binding: ProposalSubmissionBinding,
  write: () => Promise<T>,
): Promise<T> {
  announce(binding);
  try {
    return await write();
  } finally {
    announce(binding);
  }
}
