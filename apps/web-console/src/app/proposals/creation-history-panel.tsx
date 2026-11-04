'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { backupOperation } from '../sync/receipt/backup-operation';
import { encodeProposalOriginal, type ProposalSubmissionBinding } from './original-model';
import {
  CREATION_HISTORY_FILE_BYTES,
  creationRecordedReceipt,
  creationObservationStatus,
  type CreationObservation,
} from './creation-history-model';
import {
  inspectCreationHistory,
  prepareCreationHistory,
  type CreationHistoryCandidate,
} from './creation-history-file';

export function CreationHistoryPanel({
  binding,
  live,
  confirmedLive,
  disabled = false,
  begin,
  end,
}: {
  binding: ProposalSubmissionBinding;
  live?: CreationObservation;
  confirmedLive?: CreationObservation;
  disabled?: boolean;
  begin?: () => boolean;
  end?: () => void;
}) {
  const [selected, setSelected] = useState<{
    candidate: CreationHistoryCandidate;
    source: 'received' | 'file';
  }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    'Inspect a received result or import a complete history file. Files are historical copies and do not update this page’s submission result.',
  );
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
  async function run(
    work: (check: () => void) => Promise<CreationHistoryCandidate>,
    receive: (value: CreationHistoryCandidate) => void,
  ) {
    if (!mounted.current || disabled || operation.current || (begin && !begin())) return;
    const controller = new AbortController();
    operation.current = controller;
    release.current = end;
    setBusy(true);
    try {
      const candidate = await backupOperation(controller.signal, (_signal, check) => work(check));
      if (mounted.current && operation.current === controller && !controller.signal.aborted)
        receive(candidate);
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          'The complete history file or download could not be confirmed. Keep the source file and any retained observation; the inspected copy remains available. No proposal was sent or saved by this action.',
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
  function inspect(candidate: CreationHistoryCandidate, source: 'received' | 'file') {
    setSelected({ candidate, source });
    setMessage(
      'The complete historical observation is available for inspection and export. Its checksum establishes internal consistency, not authenticity or the proposal’s current state.',
    );
  }
  function download(originalOnly: boolean) {
    if (!selected) return;
    void run(
      (check) => inspectCreationHistory(selected.candidate.raw, binding, check),
      (candidate) => {
        const raw = originalOnly
          ? encodeProposalOriginal(candidate.file.document.original)
          : candidate.raw;
        const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
        try {
          const link = document.createElement('a');
          link.href = url;
          link.download = originalOnly
            ? 'proposal-original.json'
            : 'proposal-creation-history.json';
          document.body.append(link);
          try {
            link.click();
          } finally {
            link.remove();
          }
          setMessage(
            originalOnly
              ? 'Original request download requested. Check that it was saved, then use the original request recovery page to explicitly check its receipt. Extraction does not send or save a proposal.'
              : 'History file download requested. Check that the complete file was saved before leaving this page. The original observation time and response are unchanged.',
          );
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      },
    );
  }
  const locked = disabled || busy;
  const observation = selected?.candidate.file.document;
  const recorded = observation ? creationRecordedReceipt(observation) : undefined;
  return (
    <section
      className="side-detail"
      aria-label="Creation history files"
      aria-busy={busy}
      style={{ overflowWrap: 'anywhere' }}
    >
      <h3>Creation history files</h3>
      <p>
        Keep the complete original request and received response together. This page retains
        observations in memory; export a file before leaving. Importing does not save browser
        copies, query the gateway or send a proposal.
      </p>
      {[
        ...(live ? [{ label: 'Latest received result', value: live }] : []),
        ...(confirmedLive && confirmedLive !== live
          ? [{ label: 'Retained confirmed result', value: confirmedLive }]
          : []),
      ].map(({ label, value }) => (
        <div key={label}>
          <p>
            {label} · {creationObservationStatus(value)} · {value.observed_at}
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={locked}
            onClick={() =>
              void run(
                (check) => prepareCreationHistory(value, check),
                (candidate) => inspect(candidate, 'received'),
              )
            }
          >
            Inspect {label.toLowerCase()} for export
          </button>
        </div>
      ))}
      <label>
        Import complete creation history file
        <input
          type="file"
          accept="application/json,.json"
          disabled={locked}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            void run(
              async (check) => {
                check();
                if (file.size < 1 || file.size > CREATION_HISTORY_FILE_BYTES) throw new TypeError();
                const bytes = await file.arrayBuffer();
                check();
                if (
                  bytes.byteLength !== file.size ||
                  bytes.byteLength > CREATION_HISTORY_FILE_BYTES
                )
                  throw new TypeError();
                return inspectCreationHistory(
                  new TextDecoder('utf-8', { fatal: true }).decode(bytes),
                  binding,
                  check,
                );
              },
              (candidate) => inspect(candidate, 'file'),
            );
          }}
        />
      </label>
      {selected && observation && (
        <div>
          <h4>Inspected creation observation</h4>
          <p>
            Loaded from ·{' '}
            {selected.source === 'received' ? 'this page’s received response' : 'an imported file'}
          </p>
          <p>
            {creationObservationStatus(observation)} · {observation.source} · observed{' '}
            {observation.observed_at}
          </p>
          {recorded ? (
            <p>
              Original proposal · {recorded.proposal_id} · revision {recorded.revision} · event{' '}
              {recorded.event_id} · occurred {recorded.occurred_at} · cursor{' '}
              {recorded.server_cursor}. This is a historical creation result, not the current
              proposal state.
            </p>
          ) : (
            <p>
              No matching receipt was observed in this historical read. This does not prove failure,
              cancel a submission or authorize a new one.
            </p>
          )}
          <p>
            Gateway · {observation.original.binding.gateway_url} · project{' '}
            {observation.original.binding.identity.project_id}
          </p>
          <p>
            Account · {observation.original.binding.identity.actor_id} · client{' '}
            {observation.original.binding.identity.client_id}
          </p>
          <p>
            Original request key · <code>{observation.original.request_key}</code> · trace{' '}
            <code>{observation.receipt.trace_id}</code>
          </p>
          <p>
            Content checksum · <code>{selected.candidate.file.document_sha256}</code>
          </p>
          <details>
            <summary>Inspect or copy the complete original request and response</summary>
            <textarea readOnly rows={16} spellCheck={false} value={selected.candidate.raw} />
          </details>
          <div className="heading-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={locked}
              onClick={() => download(false)}
            >
              Export inspected creation history
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={locked}
              onClick={() => download(true)}
            >
              Export its original request
            </button>
          </div>
        </div>
      )}
      <p role="status">{message}</p>
      <Link href="/proposals/recover" prefetch={false} target="_blank" rel="noopener noreferrer">
        Open original request recovery ↗
      </Link>
    </section>
  );
}
