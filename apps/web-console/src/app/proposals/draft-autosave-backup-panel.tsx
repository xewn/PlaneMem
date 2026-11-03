'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProposalSubmissionBinding } from './original-model';
import type { AutosaveDraft, AutosaveBackupComparison } from './draft-autosave-backup-model';
import type { DraftAutosaveBackup, ReviewedAutosaveBackup } from './draft-autosave-backup';

export function DraftAutosaveBackupPanel<Draft extends AutosaveDraft>({
  binding,
  backup,
  label,
  disabled,
  storageEpoch,
  begin,
  end,
  onStorageChange,
}: {
  binding: ProposalSubmissionBinding;
  backup: DraftAutosaveBackup<Draft>;
  label: (draft: Draft) => string;
  disabled: boolean;
  storageEpoch: number;
  begin: () => boolean;
  end: () => void;
  onStorageChange: () => void;
}) {
  const [reviewed, setReviewed] = useState<ReviewedAutosaveBackup<Draft>>();
  const [selectedSession, setSelectedSession] = useState('');
  const [comparison, setComparison] = useState<{
    digest: string;
    epoch: number;
    value: AutosaveBackupComparison;
  }>();
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const release = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      operation.current = undefined;
      release.current?.();
      release.current = undefined;
    };
  }, []);
  useEffect(() => {
    setConfirmed(null);
    setComparison(undefined);
  }, [storageEpoch]);

  async function run(
    action: 'prepare' | 'load' | 'compare' | 'restore' | 'download',
    source?: File,
  ) {
    if (!mounted.current || disabled || operation.current) return;
    if (action === 'load' && !source) return;
    if (['compare', 'restore', 'download'].includes(action) && !reviewed) return;
    if (
      action === 'restore' &&
      (!comparison?.value.can_restore ||
        !comparison.value.entries.length ||
        comparison.epoch !== storageEpoch ||
        comparison.digest !== reviewed?.file.document_sha256 ||
        confirmed !== comparison.digest)
    )
      return;
    if (!begin()) return;
    const controller = new AbortController();
    operation.current = controller;
    release.current = end;
    setBusy(true);
    const current = () =>
      mounted.current && operation.current === controller && !controller.signal.aborted;
    if (action !== 'download') {
      setComparison(undefined);
      setConfirmed(null);
      setMessage(
        action === 'restore'
          ? 'Rechecking every automatic copy before restoring missing copies…'
          : 'Reading and checking the complete automatic draft backup…',
      );
    }
    try {
      if (action === 'prepare' || action === 'load') {
        const result =
          action === 'prepare'
            ? await backup.prepare(binding, controller.signal)
            : await backup.load(source!, binding, controller.signal);
        if (!current()) return;
        setReviewed(result);
        setSelectedSession('');
        setMessage(
          action === 'prepare'
            ? 'The complete automatic-copy backup is ready to download. Inspect its saved text: unconfirmed editor changes are not guaranteed to be included. Manual snapshots and prepared requests are separate.'
            : 'The automatic-copy backup matches this gateway and account. Inspect its contents, then compare before restoring.',
        );
      } else if (action === 'compare') {
        const result = await backup.compare(reviewed!.raw, binding, controller.signal);
        if (!current()) return;
        setReviewed({ file: result.file, raw: result.raw });
        setComparison({
          digest: result.file.document_sha256,
          epoch: storageEpoch,
          value: result.comparison,
        });
        setMessage(
          'Comparison completed without saving. Every copy is checked again during restoration; any changed or damaged copy blocks the entire restore.',
        );
      } else if (action === 'restore') {
        onStorageChange();
        const result = await backup.restore(
          reviewed!.raw,
          binding,
          comparison!.digest,
          controller.signal,
        );
        if (!current()) return;
        setMessage(
          `Restore confirmed: ${result.added} automatic copies added, ${result.already_present} identical copies kept. Refresh the automatic draft directory to inspect restored copies.`,
        );
      } else {
        const url = URL.createObjectURL(new Blob([reviewed!.raw], { type: 'application/json' }));
        try {
          const link = document.createElement('a');
          link.href = url;
          link.download = backup.filename;
          document.body.append(link);
          try {
            link.click();
          } finally {
            link.remove();
          }
          setMessage(
            'Backup download requested. Check that your browser saved the complete file before leaving.',
          );
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
    } catch {
      if (current())
        setMessage(
          action === 'restore'
            ? 'Restore could not be confirmed and may already have completed. Keep the retained backup and current fields. Compare again, then explicitly confirm before another restore.'
            : 'The operation could not be confirmed. Any previously reviewed backup remains available. Keep your file and current fields; check the backup kind, account, size and contents.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        if (mounted.current) setBusy(false);
        release.current?.();
        release.current = undefined;
      }
    }
  }
  const locked = busy || disabled;
  const matching =
    reviewed &&
    comparison &&
    comparison.digest === reviewed.file.document_sha256 &&
    comparison.epoch === storageEpoch
      ? comparison.value
      : undefined;
  const selected = reviewed?.file.document.entries.find(
    (entry) => entry.session_id === selectedSession,
  );
  return (
    <details className="side-detail">
      <summary>Back up or restore all automatic draft copies</summary>
      <div aria-busy={busy} style={{ overflowWrap: 'anywhere' }}>
        <p>
          Back up automatic copies for this gateway, project, account and client. Automatic saving
          pauses before these operations. Wait for current edits to be confirmed saved first if you
          want them included. Manual snapshots use their separate backup controls.
        </p>
        <p>
          Up to 100 automatic copies and a {backup.documentBytes / (1024 * 1024)} MiB document are
          supported; oversized or damaged collections are rejected in full.
        </p>
        <button
          type="button"
          className="secondary-button"
          disabled={locked}
          onClick={() => void run('prepare')}
        >
          Prepare complete automatic draft backup
        </button>
        <label>
          Load an automatic draft backup file
          <input
            type="file"
            accept="application/json,.json"
            disabled={locked}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void run('load', file);
            }}
          />
        </label>
        {reviewed && (
          <>
            <p>Retained automatic backup · {reviewed.file.document.entries.length} copies</p>
            <p>
              Gateway · {reviewed.file.document.binding.gateway_url} · project{' '}
              {reviewed.file.document.binding.identity.project_id}
            </p>
            <p>
              Account · {reviewed.file.document.binding.identity.actor_id} · client{' '}
              {reviewed.file.document.binding.identity.client_id}
            </p>
            <p>
              Content checksum · <code>{reviewed.file.document_sha256}</code>
            </p>
            <label>
              Inspect a complete copy from this backup
              <select
                value={selectedSession}
                disabled={locked}
                onChange={(event) => setSelectedSession(event.target.value)}
              >
                <option value="">Choose a copy</option>
                {reviewed.file.document.entries.map((entry) => (
                  <option key={entry.session_id} value={entry.session_id}>
                    {label(entry.draft)} · {entry.draft.saved_at} · {entry.session_id}
                  </option>
                ))}
              </select>
            </label>
            {selected && (
              <textarea
                aria-label="Complete automatic backup entry"
                readOnly
                rows={10}
                spellCheck={false}
                value={JSON.stringify(selected, null, 2)}
              />
            )}
            <div className="heading-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={locked}
                onClick={() => void run('download')}
              >
                Download retained automatic backup
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={locked}
                onClick={() => void run('compare')}
              >
                Compare with automatic copies
              </button>
            </div>
          </>
        )}
        {matching && (
          <>
            <p>
              {matching.missing} missing · {matching.same} identical · {matching.different}{' '}
              different
            </p>
            <details>
              <summary>Inspect every comparison</summary>
              <ul>
                {matching.entries.map((entry) => (
                  <li key={entry.session_id}>
                    Automatic copy · <code>{entry.session_id}</code> · request{' '}
                    <code>{entry.request_key}</code> · {entry.state}
                  </li>
                ))}
              </ul>
            </details>
            {matching.different > 0 && (
              <p>
                Some copies have changed contents or save times. Inspect them individually; this
                backup cannot overwrite them.
              </p>
            )}
            {matching.can_restore && matching.entries.length > 0 && (
              <>
                <label>
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={confirmed === comparison!.digest}
                    onChange={(event) => {
                      if (!operation.current)
                        setConfirmed(event.target.checked ? comparison!.digest : null);
                    }}
                  />{' '}
                  I inspected this automatic backup and its comparison. Add only missing copies.
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={locked || confirmed !== comparison!.digest}
                  onClick={() => void run('restore')}
                >
                  Restore missing automatic copies
                </button>
              </>
            )}
          </>
        )}
        <p className="muted">
          This file contains complete saved text, including sensitive local copies. Loading and
          comparison do not save anything. Restoration preserves original copy identifiers and save
          times, and leaves current editor fields unchanged. It does not start automatic saving or
          prepare or send a proposal or review. Other open pages may still update their own copies;
          the backup file keeps the captured contents. An imported file may contain only a selected
          subset; restoration considers only its listed copies. A checksum checks content, not
          authorship or submission status.
        </p>
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
