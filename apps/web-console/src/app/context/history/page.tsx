import Link from 'next/link';
import { isSyncIdentifier, type ContextItemRevision } from '@planemem/contracts';
import { Badge, Panel } from '../../../components/ui';
import { PageError, toneFor } from '../../../components/page-state';
import { readWorkbenchContextHistory, readWorkbenchContextVersion } from '../../../lib/server-api';

type Params = Record<string, string | string[] | undefined>;
export default async function ContextHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  try {
    const params = await searchParams;
    if (!isSyncIdentifier(params.item) || params.item === '.' || params.item === '..')
      throw new Error('Choose a context item to view its recorded history.');
    const id = params.item;
    const before = positiveParam(params.before);
    const requested = positiveParam(params.version);
    const page = (await readWorkbenchContextHistory(id, before)).data;
    const selectedVersion = requested ?? page.versions[0]?.version;
    let selected: ContextItemRevision | undefined;
    let detailError: unknown;
    if (selectedVersion !== undefined) {
      try {
        selected = (await readWorkbenchContextVersion(id, selectedVersion)).data;
      } catch (error) {
        detailError = error;
      }
    }
    const href = (version?: number, older?: number) => {
      const search = new URLSearchParams({ item: id });
      if (version !== undefined) search.set('version', String(version));
      if (older !== undefined) search.set('before', String(older));
      return '/context/history?' + search;
    };
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Context history</h1>
            <p>Inspect recorded versions and who changed this item.</p>
          </div>
          <Link
            className="panel-link"
            href={
              '/context?item=' +
              encodeURIComponent(id) +
              (page.current_archived ? '&view=archived' : '')
            }
          >
            Open current item · version {page.current_version}
          </Link>
        </div>
        <p className="muted">
          History starts when snapshots were first captured. A baseline preserves an existing
          version without attributing its original author. Missing versions are not reconstructed.
        </p>
        <div className="context-layout">
          <Panel title="Recorded versions" icon="context">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Operation</th>
                    <th>Recorded</th>
                    <th>Actor</th>
                  </tr>
                </thead>
                <tbody>
                  {page.versions.map((entry) => (
                    <tr
                      key={entry.version}
                      className={entry.version === selectedVersion ? 'selected' : undefined}
                    >
                      <td>
                        <Link
                          className="panel-link"
                          href={href(entry.version, before)}
                          aria-current={entry.version === selectedVersion ? 'true' : undefined}
                        >
                          v{entry.version}
                        </Link>
                      </td>
                      <td>{entry.operation}</td>
                      <td>{entry.recorded_at}</td>
                      <td>{entry.actor_id ?? 'Unknown · baseline'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!page.versions.length && (
              <p className="side-detail">
                No recorded versions on this page. Older content may predate history capture.
              </p>
            )}
            <nav className="heading-actions side-detail" aria-label="History pages">
              {before !== undefined && (
                <Link className="panel-link" href={href()}>
                  Latest recorded versions
                </Link>
              )}
              {page.next_before_version !== undefined && (
                <Link className="panel-link" href={href(undefined, page.next_before_version)}>
                  Older versions
                </Link>
              )}
            </nav>
          </Panel>
          <Panel title="Historical snapshot" icon="audit">
            <div className="side-detail">
              {detailError !== undefined && <PageError error={detailError} />}
              {selected && (
                <>
                  <h2>{selected.item.title}</h2>
                  <div className="heading-actions">
                    <Badge tone="neutral">Version {selected.version}</Badge>
                    <Badge tone={toneFor(selected.item.status)}>{selected.item.status}</Badge>
                    <Badge tone="neutral">{selected.classification}</Badge>
                    {selected.archived && <Badge tone="neutral">Archived at this version</Badge>}
                  </div>
                  <p role="status">
                    This is recorded content. Reading it does not restore it or make its sources
                    current.
                  </p>
                  <p className="muted">
                    Operation: {selected.operation}
                    <br />
                    Recorded: {selected.recorded_at}
                    <br />
                    Item updated: {selected.item.updated_at}
                  </p>
                  <p className="muted">
                    Actor: {selected.actor_id ?? 'Unknown'}
                    <br />
                    Client: {selected.client_id ?? 'Unknown'}
                    <br />
                    Event: {selected.event_id ?? 'No event attribution for a baseline'}
                  </p>
                  {selected.archived_at && <p>Archived: {selected.archived_at}</p>}
                  {selected.confirmation && (
                    <div>
                      <h3>Confirmation reason</h3>
                      <p>{selected.confirmation.reason}</p>
                      <p className="muted">
                        Reviewed version {selected.confirmation.reviewed_version} ·{' '}
                        {selected.confirmation.confirmed_at}
                      </p>
                    </div>
                  )}
                  <pre className="context-content">
                    {typeof selected.item.content === 'string'
                      ? selected.item.content
                      : JSON.stringify(selected.item.content, null, 2)}
                  </pre>
                  <h3>Recorded sources</h3>
                  <pre className="context-content">
                    {JSON.stringify(selected.item.source_refs, null, 2)}
                  </pre>
                  <details>
                    <summary>View complete snapshot</summary>
                    <pre className="context-content">{JSON.stringify(selected, null, 2)}</pre>
                  </details>
                  <Link className="panel-link" href={href(selected.version)}>
                    Link to this version
                  </Link>
                </>
              )}
              {!selected && detailError === undefined && (
                <p>Select a recorded version to inspect its content.</p>
              )}
            </div>
          </Panel>
        </div>
      </>
    );
  } catch (error) {
    return (
      <>
        <div className="page-heading">
          <h1>Context history</h1>
        </div>
        <PageError error={error} />
        <Link className="panel-link" href="/context">
          Return to context
        </Link>
      </>
    );
  }
}

function positiveParam(value: string | string[] | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d{0,15}$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new Error('History version parameters must be positive integers.');
  return Number(value);
}
