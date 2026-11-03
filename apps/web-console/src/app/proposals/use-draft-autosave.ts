'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { backupOperation } from '../sync/receipt/backup-operation';
interface Session<Draft> {
  id: string;
  previous: Draft | null;
  savedInput: string | null;
  controller: AbortController | undefined;
}

/** Each explicit start owns one mutable slot; recovery never takes over an old writer's slot. */
export function useDraftAutosave<Draft extends { saved_at: string }>({
  input,
  disabled,
  allowed,
  makeDraft,
  save,
}: {
  input: string | null;
  disabled: boolean;
  allowed: boolean;
  makeDraft: (input: string, savedAt: string) => Draft;
  save: (
    session: string,
    previous: Draft | null,
    draft: Draft,
    signal: AbortSignal,
  ) => Promise<Draft>;
}) {
  const [enabled, setEnabled] = useState(false);
  const [issue, setIssue] = useState('');
  const [revision, setRevision] = useState(0);
  const session = useRef<Session<Draft> | undefined>(undefined);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      session.current?.controller?.abort();
      session.current = undefined;
    };
  }, []);

  const pause = useCallback(() => {
    const current = session.current;
    session.current = undefined;
    current?.controller?.abort();
    setEnabled(false);
    if (current?.controller)
      setIssue(
        'The last automatic save could not be confirmed. Find automatic drafts to inspect any saved copy, or export your current text.',
      );
  }, []);

  function start() {
    if (!mounted.current || input === null || disabled || !allowed || session.current) return;
    try {
      session.current = {
        id: crypto.randomUUID(),
        previous: null,
        savedInput: null,
        controller: undefined,
      };
      setIssue('');
      setEnabled(true);
      setRevision((value) => value + 1);
    } catch {
      setIssue('Automatic saving is unavailable. Keep your text and export an editing draft.');
    }
  }

  useEffect(() => {
    const current = session.current;
    if (!enabled || !current) return;
    if (!allowed || input === null) {
      session.current = undefined;
      current.controller?.abort();
      setEnabled(false);
      setIssue(
        'Automatic saving stopped because this editor or classification is unavailable. Keep or export your text; any earlier copy remains in this browser.',
      );
      return;
    }
    if (disabled || current.controller || current.savedInput === input) return;
    const timer = setTimeout(() => {
      if (!mounted.current || session.current !== current || current.controller) return;
      const controller = new AbortController();
      current.controller = controller;
      setRevision((value) => value + 1);
      void backupOperation(controller.signal, async (signal) => {
        const draft = makeDraft(input, new Date().toISOString());
        return save(current.id, current.previous, draft, signal);
      }).then(
        (saved) => {
          if (!mounted.current || session.current !== current || controller.signal.aborted) return;
          current.previous = saved;
          current.savedInput = input;
          current.controller = undefined;
          setRevision((value) => value + 1);
        },
        () => {
          if (!mounted.current || session.current !== current) return;
          session.current = undefined;
          setEnabled(false);
          setIssue(
            'Automatic saving stopped: the last save could not be confirmed. Keep or export your text and find automatic drafts to inspect any saved copy. Starting again creates a separate copy.',
          );
        },
      );
    }, 1500);
    // New input resets only the debounce timer. An already-started write finishes in order.
    return () => clearTimeout(timer);
  }, [input, enabled, disabled, allowed, revision, makeDraft, save]);

  const current = session.current;
  const message =
    issue ||
    (!enabled
      ? 'Automatic saving is off. Existing automatic copies are kept. Starting it creates a new copy.'
      : current?.controller
        ? 'Saving an automatic copy… Newer edits may still be waiting. Keep this page open.'
        : current?.previous && current.savedInput === input
          ? `Current fields automatically saved in this browser at ${current.previous.saved_at}.`
          : disabled
            ? 'Automatic saving is waiting for the current operation to finish. Current fields are not yet confirmed saved.'
            : 'Changes are waiting for automatic saving. Keep this page open until saving is confirmed.');
  return { enabled, allowed, message, start, pause };
}
