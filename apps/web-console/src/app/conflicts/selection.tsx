import Link from 'next/link';
import { parseConflictReadQuery } from '@planemem/contracts';
import { PageError, toneFor } from '../../components/page-state';
import { Badge } from '../../components/ui';
import { getWorkbenchConflict, getWorkbenchConflictCommandContext } from '../../lib/server-api';
import { ResolutionForm } from './form';

export async function ConflictSelection({
  id,
  canResolve,
  explicit,
  position,
}: {
  id: string;
  canResolve: boolean;
  explicit: boolean;
  position: Record<string, string>;
}) {
  try {
    const query = parseConflictReadQuery({ conflict_id: id });
    let caller: Awaited<ReturnType<typeof getWorkbenchConflictCommandContext>> | undefined;
    let callerError: unknown;
    if (canResolve && explicit) {
      try {
        caller = await getWorkbenchConflictCommandContext();
      } catch (error) {
        callerError = error;
      }
    }
    const result = await getWorkbenchConflict(query.conflict_id, caller?.data.identity);
    const row = result.data;
    const open = row.status === 'open';
    // The existing resolution command uses JS numbers. Never round a stored BIGINT for a write.
    const maximum = BigInt(Number.MAX_SAFE_INTEGER);
    const safeVersions =
      [row.base_version, row.local_version, row.server_version].every(
        (value) => BigInt(value) <= maximum,
      ) && (open ? BigInt(row.version) < maximum : BigInt(row.version) <= maximum);
    return (
      <div className="side-detail">
        <h2>
          {row.entity_type} · {row.field}
        </h2>
        <p>{row.entity_id}</p>
        <Badge tone={toneFor(row.status)}>{row.status}</Badge>
        <p>
          Conflict {row.conflict_id} · conflict version {row.version} · base version{' '}
          {row.base_version}
        </p>
        <div className="diff-box">
          <div>
            <span>Local · v{row.local_version}</span>
            <SavedValue json={row.local_value_json} />
          </div>
          <div>
            <span>Server · v{row.server_version}</span>
            <SavedValue json={row.server_value_json} />
          </div>
        </div>
        <p className="muted">
          Saved JSON is displayed as text to preserve large numbers. An unrecorded value is labeled
          separately from JSON null.
        </p>
        <h3 className="detail-section-title">Decision record</h3>
        {row.decision_state === 'none' ? (
          <p>No decision is recorded in this snapshot.</p>
        ) : (
          <>
            {row.decision_state === 'legacy' && (
              <p>
                This legacy decision has no saved resolution event reference. Missing metadata is
                not reconstructed.
              </p>
            )}
            <p>Resolution · {row.resolution ?? 'Not recorded'}</p>
            <p>Client · {row.resolved_by_client ?? 'Not recorded'}</p>
            <p>Recorded · {row.resolved_at ?? 'Not recorded'}</p>
            <p>Event · {row.resolution_event_id ?? 'Not recorded'}</p>
            <h4>Saved selected value</h4>
            <SavedValue json={row.resolved_value_json} />
          </>
        )}
        <p>
          This snapshot does not confirm an original resolution request or show that a decision was
          applied to its source entity.
        </p>
        {canResolve && open && !safeVersions && (
          <p>
            The recorded versions exceed this decision form’s supported range. No write version has
            been rounded.
          </p>
        )}
        {canResolve && safeVersions && explicit && caller && (
          <ResolutionForm
            key={JSON.stringify([id, caller.data.identity])}
            id={id}
            version={Number(row.version)}
            open={open}
            identity={caller.data.identity}
          />
        )}
        {canResolve && safeVersions && explicit && !caller && (
          <>
            <p>
              The decision identity could not be verified. Existing original requests remain saved.
            </p>
            <PageError error={callerError} />
            <Link href="/conflicts/recover" prefetch={false}>
              Recover a saved original request
            </Link>
          </>
        )}
        {canResolve && open && safeVersions && !explicit && (
          <Link
            className="primary-button"
            href={{ pathname: '/conflicts', query: { ...position, item: id } }}
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Review this decision ↗
          </Link>
        )}
        {!canResolve && open && <p>Resolving this conflict requires conflict resolution access.</p>}
        <p>Record actor · {row.actor_id ?? 'Not recorded'}</p>
        <p>Record trace · {row.trace_id}</p>
        <p>Detail read trace · {result.trace_id}</p>
        <h3>Recorded sources</h3>
        {row.source_refs.length ? (
          <ul>
            {row.source_refs.map((ref, index) => (
              <li key={index} style={{ overflowWrap: 'anywhere' }}>
                {ref.type} · {ref.id}
                {ref.revision === undefined ? '' : ' · revision ' + ref.revision}
              </li>
            ))}
          </ul>
        ) : (
          <p>No sources recorded.</p>
        )}
        <Link
          className="panel-link"
          href={{ pathname: '/audit', query: { resource: 'conflict:' + id } }}
          target="_blank"
          rel="noreferrer"
          prefetch={false}
        >
          View conflict audit ↗
        </Link>
      </div>
    );
  } catch (error) {
    return (
      <>
        <p>The selected detail could not be read. The directory remains available.</p>
        <PageError error={error} />
      </>
    );
  }
}

function SavedValue({ json }: { json: string | null }) {
  return json === null ? (
    <p className="muted">Value not recorded</p>
  ) : (
    <pre className="json-view" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {json}
    </pre>
  );
}
