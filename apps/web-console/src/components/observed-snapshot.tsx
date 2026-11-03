import type { ObservedSnapshot, ObservedWorkItemContext, SourceRef } from '@planemem/contracts';
import { PageError, textValue, toneFor } from './page-state';
import { Badge, EmptyState, Panel } from './ui';
import { WorkbenchApiError } from '../lib/server-api';

export function ObservedSnapshotView({
  snapshot,
  trace,
}: {
  snapshot: ObservedSnapshot;
  trace: string;
}) {
  const deleted = snapshot.schema_version === 2;
  const title = textValue(
    snapshot.fields.title,
    textValue(snapshot.fields.name, snapshot.external_id),
  );
  return (
    <>
      <Panel
        title={deleted ? 'Saved Plane deletion observation' : 'Saved Plane observation'}
        icon="work"
      >
        <div className="side-detail" style={{ overflowWrap: 'anywhere' }}>
          <h2>{title}</h2>
          <div className="drawer-badges">
            <Badge>Plane</Badge>
            <Badge>{snapshot.classification}</Badge>
            {deleted ? <Badge tone="red">Deleted observation</Badge> : null}
            {snapshot.restored_from ? <Badge tone="green">Restored observation</Badge> : null}
            {snapshot.status ? (
              <Badge tone={toneFor(snapshot.status)}>{snapshot.status}</Badge>
            ) : null}
          </div>
          <div className="detail-grid">
            <div>
              <small>External ID</small>
              <strong>{snapshot.external_id}</strong>
            </div>
            <div>
              <small>Observed version</small>
              <strong>{snapshot.plane_version}</strong>
            </div>
            <div>
              <small>Source observation time (UTC)</small>
              <strong>
                <time dateTime={snapshot.observed_at}>{snapshot.observed_at}</time>
              </strong>
            </div>
          </div>
          <p>
            This is a saved observation. Its timestamp records the source event time; opening this
            page does not fetch the current state from Plane.
          </p>
          {deleted ? (
            <p>
              Deletion recorded at {snapshot.deleted_at}. The corresponding local search index is
              inactive, and this observation cannot be used to generate a work item context summary.
              This does not confirm removal of external memory copies or local work item records.
            </p>
          ) : (
            <p style={{ whiteSpace: 'pre-wrap' }}>
              {textValue(snapshot.fields.description, 'No plain-text description recorded.')}
            </p>
          )}
          {snapshot.restored_from ? (
            <p>
              This observation restored deletion version {snapshot.restored_from.aggregate_version}{' '}
              (event {snapshot.restored_from.event_id}) using new fields from Plane. Saved access
              classification and index expiry were preserved. External memory copies and local work
              item records were not restored by this event.
            </p>
          ) : null}
          <details>
            <summary>Saved fields and record identifiers</summary>
            <dl>
              <dt>Tenant</dt>
              <dd>{snapshot.tenant_id}</dd>
              <dt>Workspace</dt>
              <dd>{snapshot.workspace_id}</dd>
              <dt>Project</dt>
              <dd>{snapshot.project_id}</dd>
              <dt>Aggregate ID</dt>
              <dd>{snapshot.aggregate_id}</dd>
              <dt>Source event ID</dt>
              <dd>{snapshot.source_event_id}</dd>
            </dl>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {JSON.stringify(snapshot.fields, null, 2)}
            </pre>
          </details>
        </div>
      </Panel>
      <Panel title="Recorded sources" icon="work">
        <div className="side-detail" style={{ overflowWrap: 'anywhere' }}>
          <p>
            References saved with the source event. Their current availability has not been checked.
          </p>
          <ObservedSources refs={snapshot.source_refs} />
          <p className="muted">Read trace ID: {trace}</p>
        </div>
      </Panel>
    </>
  );
}

export function ObservedContextView({
  context,
}: {
  context: ObservedWorkItemContext['context_pack'];
}) {
  return (
    <Panel title="Context summary" icon="context">
      <div className="side-detail" style={{ overflowWrap: 'anywhere' }}>
        <div className="drawer-badges">
          <Badge tone={context.degraded ? 'yellow' : 'neutral'}>
            {context.degraded ? 'Limited context' : 'Context available'}
          </Badge>
          <Badge>
            {context.memory_used ? 'External memory consulted' : 'External memory not used'}
          </Badge>
        </div>
        <p>
          The first entry summarizes this observation. Additional entries come from external memory.
          This summary is not a saved context pack.
        </p>
        {context.degraded ? (
          <p>
            External context may be unavailable, unconfigured, or outside your access. The saved
            observation is still shown.
          </p>
        ) : null}
        <p>Query: {context.query}</p>
        {context.hits.map((hit, index) => (
          <article className="proposal" key={JSON.stringify([hit.rank_source, hit.id])}>
            <h3>{hit.title}</h3>
            <p className="muted">
              {index === 0 ? 'Saved observation' : 'External memory'} · Revision {hit.revision} ·{' '}
              {hit.classification}
            </p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{hit.snippet || 'No summary text recorded.'}</p>
            <details>
              <summary>Recorded sources</summary>
              <ObservedSources refs={hit.source_refs} />
            </details>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function ObservedSources({ refs }: { refs: SourceRef[] }) {
  return refs.length ? (
    <ul>
      {refs.map((ref, index) => (
        <li key={index}>
          <strong>
            {ref.type} · {ref.id}
          </strong>
          {ref.revision === undefined ? null : <p>Recorded revision: {ref.revision}</p>}
          {ref.uri ? <p>{ref.uri}</p> : null}
        </li>
      ))}
    </ul>
  ) : (
    <p>No source references recorded.</p>
  );
}

export function ObservedReadError({ error }: { error: unknown }) {
  if (error instanceof WorkbenchApiError && error.code === 'OBSERVED_RECORD_DELETED')
    return (
      <Panel title="Deleted work item observation" icon="work">
        <EmptyState
          title="Context is unavailable for this deleted observation"
          message="Uncheck Include context and read the saved state to see the deletion marker. No external memory was recalled for this request."
          trace={error.trace_id}
        />
      </Panel>
    );
  return error instanceof WorkbenchApiError && error.status === 404 ? (
    <Panel title="Observation unavailable" icon="work">
      <EmptyState
        title="No readable observation"
        message="No complete saved Plane observation is available for this ID in the current project. Check the external or aggregate ID and your project access."
        trace={error.trace_id}
      />
    </Panel>
  ) : (
    <PageError error={error} />
  );
}
