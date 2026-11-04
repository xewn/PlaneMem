'use client';

import { useEffect, useRef, useState } from 'react';
import { parsePackSaveBinding, type PackSaveBinding } from '@planemem/contracts';
import { backupOperation } from '../sync/receipt/backup-operation';
import {
  capturePackReceiptBackupFiles,
  comparePackReceiptBackupFiles,
  type PackReceiptBackupFileComparison,
} from './save-receipt-backup-comparison';

type Side = 'from' | 'to';
type Inputs = {
  from: ReturnType<typeof capturePackReceiptBackupFiles>;
  to: ReturnType<typeof capturePackReceiptBackupFiles>;
  fromExpected: string;
  toExpected: string;
};
type Report = PackReceiptBackupFileComparison & { generation: number };
type Presence = 'all' | 'both' | 'from-only' | 'to-only';
const emptyInputs: Inputs = { from: [], to: [], fromExpected: '', toExpected: '' };
const PAGE_SIZE = 50;
const labels = { both: 'Both backups', 'from-only': 'Left only', 'to-only': 'Right only' };
const validChecksum = (value: string) => !value.trim() || /^[a-f0-9]{64}$/.test(value.trim());

function download(report: Report) {
  const url = URL.createObjectURL(new Blob([report.raw], { type: 'application/json' }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = `context-pack-backup-comparison-${report.result.data.from.document_sha256}-${report.result.data.to.document_sha256}.json`;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function PackReceiptBackupComparisonPanel({
  binding,
  disabled,
  begin,
  end,
}: {
  binding: PackSaveBinding;
  disabled: boolean;
  begin: () => boolean;
  end: () => void;
}) {
  const [inputs, setInputs] = useState<Inputs>(emptyInputs);
  const inputsRef = useRef(inputs);
  const generation = useRef(0);
  const [selectionGeneration, setSelectionGeneration] = useState(0);
  const [report, setReport] = useState<Report>();
  const reportRef = useRef<Report | undefined>(undefined);
  const [latestSucceeded, setLatestSucceeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [presence, setPresence] = useState<Presence>('all');
  const [requestKey, setRequestKey] = useState('');
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState(
    'Choose both backups, then compare their complete observations.',
  );
  const mounted = useRef(false);
  const active = useRef(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const release = useRef<(() => void) | undefined>(undefined);
  const fresh = latestSucceeded && report?.generation === selectionGeneration;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      operation.current = undefined;
      active.current = false;
      release.current?.();
      release.current = undefined;
    };
  }, []);

  function changeInputs(next: Inputs) {
    if (!mounted.current || active.current || disabled) return;
    inputsRef.current = next;
    setInputs(next);
    generation.current++;
    setSelectionGeneration(generation.current);
    setLatestSucceeded(false);
    setMessage('Inputs changed. Compare again; any earlier report remains available below.');
  }

  function selectFiles(side: Side, files: File[]) {
    if (!files.length || !mounted.current || active.current || disabled) return;
    try {
      const captured = capturePackReceiptBackupFiles(files);
      changeInputs({ ...inputsRef.current, [side]: captured });
    } catch {
      setLatestSucceeded(false);
      setMessage(
        'Choose one backup, or its manifest and all volumes together (up to 11 files). Empty or oversized files and duplicate selections are rejected. Earlier selections and any report are retained.',
      );
    }
  }

  async function compare() {
    const captured = inputsRef.current;
    if (!captured.from.length || !captured.to.length) return;
    if (!mounted.current || active.current || disabled || !begin()) return;
    const startedGeneration = generation.current;
    active.current = true;
    release.current = end;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setLatestSucceeded(false);
    setMessage(
      'Reading both complete backups and checking their observations. Any earlier report remains below.',
    );
    try {
      const expected = parsePackSaveBinding(binding);
      const result = await backupOperation(controller.signal, (signal, check) =>
        comparePackReceiptBackupFiles(
          captured.from.map((entry) => entry.file),
          captured.to.map((entry) => entry.file),
          expected,
          captured.fromExpected,
          captured.toExpected,
          signal,
          check,
        ),
      );
      if (!mounted.current || operation.current !== controller) return;
      if (startedGeneration !== generation.current || captured !== inputsRef.current) {
        setMessage(
          'Inputs changed during comparison. Compare again; any earlier report is retained.',
        );
        return;
      }
      const next = { ...result, generation: startedGeneration };
      reportRef.current = next;
      setReport(next);
      setPresence('all');
      setRequestKey('');
      setPage(0);
      setLatestSucceeded(true);
      setMessage(
        result.result.data.comparison.conflicting_request_keys.length
          ? 'Comparison completed. Some request keys have different original requests; review all variants below. No history was changed.'
          : 'Comparison completed. The report describes the selected files; no history was changed.',
      );
    } catch {
      if (mounted.current && operation.current === controller)
        setMessage(
          controller.signal.aborted
            ? 'Stopped waiting. No new report was accepted; any earlier report is retained.'
            : 'The complete comparison could not be confirmed. Check for missing or damaged files, a different identity, checksum constraints or limits. The operation may also have timed out. Any earlier report is retained.',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        active.current = false;
        release.current?.();
        release.current = undefined;
        if (mounted.current) setBusy(false);
      }
    }
  }

  function exportReport() {
    const captured = reportRef.current;
    if (
      !captured ||
      captured !== report ||
      !mounted.current ||
      active.current ||
      disabled ||
      !begin()
    )
      return;
    active.current = true;
    try {
      download(captured);
      setMessage(
        'Download requested for the displayed report, including every observation and conflict regardless of filters. Confirm the download in your browser. This report is not a recoverable backup.',
      );
    } catch {
      setMessage(
        'The report download could not be requested. The complete report remains available here.',
      );
    } finally {
      active.current = false;
      end();
    }
  }

  const data = report?.result.data;
  const rows =
    data?.comparison.entries.filter(
      (entry) =>
        (presence === 'all' || entry.presence === presence) &&
        (!requestKey || entry.request_key === requestKey),
    ) ?? [];
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1));
  const offset = currentPage * PAGE_SIZE;
  return (
    <section className="handoff-form" aria-label="Compare two historical backups">
      <h2>Compare two backup copies</h2>
      <p>
        Choose one backup file or a manifest and every volume on each side. Each side can contain up
        to 1,000 observations in 10 volumes; a single backup holds up to 100. Both must match the
        gateway, project, account, client and permission scope shown above.
      </p>
      <p>
        This compares the selected files, independently of browser history and directory filters.
        Left and right do not imply newer or better. Nothing is uploaded, restored or removed.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void compare();
        }}
      >
        {(['from', 'to'] as const).map((side) => {
          const name = side === 'from' ? 'Left' : 'Right';
          const expectedField = side === 'from' ? 'fromExpected' : 'toExpected';
          return (
            <fieldset key={side} disabled={busy || disabled} style={{ minWidth: 0 }}>
              <legend>{name} backup</legend>
              <label>
                Choose all files for the {name.toLowerCase()} backup
                <input
                  type="file"
                  multiple
                  accept="application/json,.json"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = '';
                    selectFiles(side, files);
                  }}
                />
              </label>
              {inputs[side].length ? (
                <ul>
                  {inputs[side].map((entry, index) => (
                    <li key={index} style={{ overflowWrap: 'anywhere' }}>
                      {entry.name} · {entry.size} bytes
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No files selected.</p>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={!inputs[side].length}
                onClick={() => changeInputs({ ...inputsRef.current, [side]: [] })}
              >
                Clear {name.toLowerCase()} files
              </button>
              <label>
                Expected backup or manifest checksum (optional)
                <input
                  type="text"
                  value={inputs[expectedField]}
                  maxLength={64}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!validChecksum(inputs[expectedField])}
                  onChange={(event) =>
                    changeInputs({ ...inputsRef.current, [expectedField]: event.target.value })
                  }
                />
              </label>
              {!validChecksum(inputs[expectedField]) && (
                <p role="status">Use 64 lowercase hexadecimal characters, or leave this empty.</p>
              )}
            </fieldset>
          );
        })}
        <button
          type="submit"
          className="secondary-button"
          disabled={
            busy ||
            disabled ||
            !inputs.from.length ||
            !inputs.to.length ||
            !validChecksum(inputs.fromExpected) ||
            !validChecksum(inputs.toExpected)
          }
        >
          Compare complete backups
        </button>
      </form>
      {busy && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => operation.current?.abort()}
        >
          Stop waiting
        </button>
      )}
      <p role="status">{message}</p>
      {data && (
        <div>
          <h3>{fresh ? 'Last completed file comparison' : 'Earlier file comparison'}</h3>
          {!fresh && (
            <p>
              This retained report describes its recorded input files, not a new comparison of the
              current selection.
            </p>
          )}
          <p>
            {data.comparison.same_observations
              ? 'Both backups contain the same observations.'
              : 'The backups contain different observations.'}{' '}
            Shared: {data.comparison.shared_observations} · Left only:{' '}
            {data.comparison.from_only_observations} · Right only:{' '}
            {data.comparison.to_only_observations}.
          </p>
          <p>
            Checksums confirm internal consistency, not server authenticity or current server state.
            Files are read separately; this report does not establish a single moment across both
            sets.
          </p>
          <table>
            <caption>Backups used in this report</caption>
            <thead>
              <tr>
                <th scope="col">Side</th>
                <th scope="col">Format</th>
                <th scope="col">Observations</th>
                <th scope="col">Files and references</th>
              </tr>
            </thead>
            <tbody>
              {(['from', 'to'] as const).map((side) => (
                <tr key={side}>
                  <th scope="row">{side === 'from' ? 'Left' : 'Right'}</th>
                  <td>{data[side].kind === 'single' ? 'Single backup' : 'Manifest and volumes'}</td>
                  <td>{data[side].observations}</td>
                  <td>
                    {data[side].input_files} files · {data[side].input_bytes} bytes
                    <details>
                      <summary>Input names and checksums</summary>
                      <p>
                        Backup or manifest checksum:{' '}
                        <code style={{ overflowWrap: 'anywhere' }}>
                          {data[side].document_sha256}
                        </code>
                      </p>
                      <p>
                        Expected checksum:{' '}
                        <code style={{ overflowWrap: 'anywhere' }}>
                          {data.expected_document_sha256[side] ?? 'Not supplied'}
                        </code>
                      </p>
                      <ul>
                        {data.local_inputs[side].map((input, index) => (
                          <li key={index} style={{ overflowWrap: 'anywhere' }}>
                            {input.name} · {input.file_bytes} bytes ·{' '}
                            <code>{input.file_sha256}</code>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            A single file may represent a subset. A volume set is complete only relative to its
            supplied manifest; neither establishes all browser or server history.
          </p>
          <fieldset disabled={busy || disabled} style={{ minWidth: 0 }}>
            <legend>View observations in this report</legend>
            <label>
              Present in
              <select
                value={presence}
                onChange={(event) => {
                  setPresence(event.target.value as Presence);
                  setPage(0);
                }}
              >
                <option value="all">Either backup</option>
                <option value="both">Both backups</option>
                <option value="from-only">Left only</option>
                <option value="to-only">Right only</option>
              </select>
            </label>
            <label>
              Exact request key (optional)
              <input
                type="text"
                maxLength={255}
                autoComplete="off"
                spellCheck={false}
                value={requestKey}
                onChange={(event) => {
                  setRequestKey(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setPresence('all');
                setRequestKey('');
                setPage(0);
              }}
            >
              Clear report filters
            </button>
            <p role="status">
              {rows.length} of {data.comparison.entries.length} observations match. Showing{' '}
              {rows.length ? offset + 1 : 0}–{Math.min(offset + PAGE_SIZE, rows.length)}. Filters
              affect only this view.
            </p>
            {rows.length > 0 ? (
              <table>
                <caption>Observations ordered by checksum, up to 50 per page</caption>
                <thead>
                  <tr>
                    <th scope="col">Observation</th>
                    <th scope="col">Present in</th>
                    <th scope="col">Observed at (UTC)</th>
                    <th scope="col">Historical result</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(offset, offset + PAGE_SIZE).map((entry) => (
                    <tr key={entry.document_sha256}>
                      <th scope="row" style={{ overflowWrap: 'anywhere' }}>
                        {entry.request_key}
                        <details>
                          <summary>Observation checksum</summary>
                          <code>{entry.document_sha256}</code>
                        </details>
                      </th>
                      <td>{labels[entry.presence]}</td>
                      <td>
                        <time dateTime={entry.observed_at}>{entry.observed_at}</time>
                      </td>
                      <td>
                        {entry.status === 'recorded' ? 'Save recorded' : 'No record observed'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No observations match this view.</p>
            )}
            <button
              type="button"
              className="secondary-button"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous observations
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={offset + PAGE_SIZE >= rows.length}
              onClick={() => setPage(currentPage + 1)}
            >
              Next observations
            </button>
          </fieldset>
          <p>
            Request keys with different original requests:{' '}
            {data.comparison.conflicting_request_keys.length}. Repeated observations of the same
            original request are kept separately.
          </p>
          {data.comparison.conflicting_request_keys.length > 0 && (
            <details>
              <summary>Review all conflicting request keys</summary>
              <p>
                Conflicts may occur within either backup or across both. No original is chosen as
                correct, even when the observation sets match.
              </p>
              {data.comparison.conflicting_request_keys.map((conflict) => (
                <div key={conflict.request_key}>
                  <h4 style={{ overflowWrap: 'anywhere' }}>{conflict.request_key}</h4>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || disabled}
                    onClick={() => {
                      setRequestKey(conflict.request_key);
                      setPresence('all');
                      setPage(0);
                    }}
                  >
                    Show observations for this key
                  </button>
                  {conflict.variants.map((variant, index) => (
                    <details key={variant.original_sha256}>
                      <summary>
                        Original request {index + 1} · {variant.observation_digests.length}{' '}
                        observations
                      </summary>
                      <p>
                        Original checksum:{' '}
                        <code style={{ overflowWrap: 'anywhere' }}>{variant.original_sha256}</code>
                      </p>
                      <ul>
                        {variant.observation_digests.map((digest) => (
                          <li key={digest}>
                            <code style={{ overflowWrap: 'anywhere' }}>{digest}</code>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              ))}
            </details>
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={busy || disabled}
            onClick={exportReport}
          >
            Download complete comparison report
          </button>
          <p>
            The download includes every observation and conflict, regardless of filters or page.
            Keep the original backup files: this report contains comparison details and cannot
            restore observations.
          </p>
        </div>
      )}
    </section>
  );
}
