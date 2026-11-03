'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProposalSubmissionBinding } from './original-model';
import type { EditingBackupComparison } from './editing-store';
import {
  compareEditingDraftBackup,
  loadEditingDraftBackup,
  prepareEditingDraftBackup,
  restoreEditingDraftBackup,
  type ReviewedEditingBackup,
} from './editing-backup';

export function EditingBackupPanel({
  binding,
  disabled,
  begin,
  end,
  onStorageChange,
}: {
  binding: ProposalSubmissionBinding;
  disabled: boolean;
  begin: () => boolean;
  end: () => void;
  onStorageChange: () => void;
}) {
  const [reviewed, setReviewed] = useState<ReviewedEditingBackup>();
  const [comparison, setComparison] = useState<{
    digest: string;
    value: EditingBackupComparison;
  }>();
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      operation.current = undefined;
    };
  }, []);

  async function run(
    action: 'prepare' | 'load' | 'compare' | 'restore' | 'download',
    source?: File,
  ) {
    if (disabled || operation.current || !mounted.current) return;
    if (action === 'load' && !source) return;
    if (['compare', 'restore', 'download'].includes(action) && !reviewed) return;
    if (
      action === 'restore' &&
      (!comparison?.value.can_restore ||
        !comparison.value.entries.length ||
        comparison.digest !== reviewed?.file.document_sha256 ||
        confirmed !== comparison.digest)
    )
      return;
    if (!begin()) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    const isCurrent = () =>
      mounted.current && operation.current === controller && !controller.signal.aborted;
    if (action !== 'download') {
      setConfirmed(null);
      setComparison(undefined);
      setMessage(
        action === 'restore'
          ? 'Checking all drafts before restoring missing copies…'
          : 'Reading and checking the complete editing backup…',
      );
    }
    try {
      if (action === 'prepare' || action === 'load') {
        const result =
          action === 'prepare'
            ? await prepareEditingDraftBackup(binding, controller.signal)
            : await loadEditingDraftBackup(source!, binding, controller.signal);
        if (!isCurrent()) return;
        setReviewed(result);
        setMessage(
          action === 'prepare'
            ? 'The complete saved-draft backup is ready to download. Unsaved editor changes are not included.'
            : 'The editing backup matches this gateway and account. Compare it with this browser before restoring.',
        );
      } else if (action === 'compare') {
        const result = await compareEditingDraftBackup(reviewed!.raw, binding, controller.signal);
        if (!isCurrent()) return;
        setReviewed({ file: result.file, raw: result.raw });
        setComparison({ digest: result.file.document_sha256, value: result.comparison });
        setMessage(
          'Comparison completed without saving. Restore checks every copy again; any changed or damaged copy blocks the whole import.',
        );
      } else if (action === 'restore') {
        onStorageChange();
        const result = await restoreEditingDraftBackup(
          reviewed!.raw,
          binding,
          comparison!.digest,
          controller.signal,
        );
        if (!isCurrent()) return;
        setMessage(
          `Restore confirmed: ${result.added} drafts added, ${result.already_present} identical copies kept. Use Find saved drafts to choose a copy for editing.`,
        );
      } else {
        const url = URL.createObjectURL(new Blob([reviewed!.raw], { type: 'application/json' }));
        try {
          const link = document.createElement('a');
          link.href = url;
          link.download = 'proposal-editing-drafts-backup.json';
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
      if (isCurrent())
        setMessage(
          action === 'restore'
            ? 'Restore could not be confirmed and may already have completed. Keep the retained backup, compare again, then explicitly decide whether to restore. Your current editor is preserved.'
            : 'The operation could not be confirmed. Any previously reviewed backup remains available below. Keep the source file and check the backup scope, size and contents.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        if (mounted.current) setBusy(false);
        end();
      }
    }
  }
  const locked = disabled || busy;
  const matching =
    reviewed && comparison && comparison.digest === reviewed.file.document_sha256
      ? comparison.value
      : undefined;
  return (
    <details className="side-detail">
      <summary>Back up or restore all saved editing drafts</summary>
      <div aria-busy={busy} style={{ overflowWrap: 'anywhere' }}>
        <p>
          Back up all saved editing drafts for this gateway, project, account and client. Save your
          current edits first if you want them included. Up to 100 drafts and a 16 MiB document are
          supported; larger collections are rejected as a whole.
        </p>
        <button
          type="button"
          className="secondary-button"
          disabled={locked}
          onClick={() => void run('prepare')}
        >
          Prepare saved-draft backup
        </button>
        <label>
          Load an editing draft backup file
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
            <p>Retained editing backup · {reviewed.file.document.entries.length} drafts</p>
            <p>Gateway · {reviewed.file.document.binding.gateway_url}</p>
            <p>Project · {reviewed.file.document.binding.identity.project_id}</p>
            <p>
              Account · {reviewed.file.document.binding.identity.actor_id} · Client ·{' '}
              {reviewed.file.document.binding.identity.client_id}
            </p>
            <details>
              <summary>Review included drafts</summary>
              <ul>
                {reviewed.file.document.entries.map((entry) => (
                  <li key={entry.request_key}>
                    {entry.fields.values.title || 'Untitled draft'} ·{' '}
                    {entry.fields.values.classification} · saved {entry.saved_at} ·{' '}
                    <code>{entry.request_key}</code>
                  </li>
                ))}
              </ul>
              <p>
                Content checksum · <code>{reviewed.file.document_sha256}</code>
              </p>
            </details>
            <div className="heading-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={locked}
                onClick={() => void run('download')}
              >
                Download retained editing backup
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={locked}
                onClick={() => void run('compare')}
              >
                Compare with saved drafts
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
              <summary>Review every comparison</summary>
              <ul>
                {matching.entries.map((entry) => (
                  <li key={entry.request_key}>
                    {entry.title || 'Untitled draft'} · <code>{entry.request_key}</code> ·{' '}
                    {entry.state}
                  </li>
                ))}
              </ul>
            </details>
            {matching.different > 0 && (
              <p>
                Some copies differ in content or original save time. Review them individually; this
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
                  I reviewed this editing backup and comparison. Add only the missing copies.
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={locked || confirmed !== comparison!.digest}
                  onClick={() => void run('restore')}
                >
                  Restore missing editing drafts
                </button>
              </>
            )}
          </>
        )}
        <p className="muted">
          This backup contains complete saved text, including sensitive local copies. Keep the
          downloaded file accordingly. Prepared submissions and receipts are not included here.
          Loading and comparing do not save anything. Restoring adds local editing copies without
          replacing current editor fields or submitting proposals. The checksum detects content
          changes; it does not prove who created the file or whether its sources are current.
        </p>
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  );
}
