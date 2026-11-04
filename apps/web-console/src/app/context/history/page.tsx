import Link from 'next/link';
import type { ContextItemRevision } from '@planemem/contracts';
import { Badge, Panel } from '../../../components/ui';
import { PageError, toneFor } from '../../../components/page-state';
import { readWorkbenchContextHistory, readWorkbenchContextVersion } from '../../../lib/server-api';
import {
  parseContextHistoryParams,
  contextHistoryHref,
  contextBrowseHref,
  contextComparisonHref,
  type ContextHistoryNavigation,
  type ContextSearchParams,
} from '../navigation';
import { ContextComparisonForm } from './compare/form';

export default async function ContextHistoryPage({
  searchParams,
}: {
  searchParams: Promise<ContextSearchParams>;
}) {
  let navigation: ContextHistoryNavigation | undefined;
  try {
    const current = parseContextHistoryParams(await searchParams);
    navigation = current;
    const { item_id: id, before, version: requested } = current;
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
    const href = (version?: number, older?: number) =>
      contextHistoryHref({
        ...current,
        version,
        before: older,
      });
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Context history</h1>
            <p>Inspect recorded versions and who changed this item.</p>
          </div>
          <nav className="heading-actions" aria-label="Context history navigation">
            {current.return_href && (
              <Link className="panel-link" href={current.return_href} prefetch={false}>
                Back to results
              </Link>
            )}
            <Link
              className="panel-link"
              href={contextBrowseHref({
                filters: { limit: 25, archived: page.current_archived },
                item: id,
              })}
              prefetch={false}
            >
              Open current item · version {page.current_version}
            </Link>
          </nav>
        </div>
        <p className="muted">
          History starts when snapshots were first captured. A baseline preserves an existing
          version without attributing its original author. Missing versions are not reconstructed.
        </p>
        {page.versions.length >= 2 && (
          <Panel title="Compare recorded versions" icon="search">
            <div className="side-detail">
              <ContextComparisonForm
                navigation={{
                  history: { ...current, version: selectedVersion },
                  from_version: page.versions[1]!.version,
                  to_version: page.versions[0]!.version,
                }}
                versions={page.versions.map((entry) => entry.version)}
              />
              <p className="muted">
                Choose from this history page. Open a single version below to compare it with a
                version from another page.
              </p>
            </div>
          </Panel>
        )}
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
                          prefetch={false}
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
                <Link className="panel-link" href={href()} prefetch={false}>
                  Latest recorded versions
                </Link>
              )}
              {page.next_before_version !== undefined && (
                <Link
                  className="panel-link"
                  href={href(undefined, page.next_before_version)}
                  prefetch={false}
                >
                  Older versions
                </Link>
              )}
            </nav>
          </Panel>
          <Panel title="Historical snapshot" icon="audit">
            <div className="side-detail">
              {detailError !== undefined && (
                <>
                  <PageError error={detailError} />
                  {selectedVersion !== undefined && (
                    <HistoryRetry
                      navigation={{ ...current, version: selectedVersion }}
                      label="Retry this version"
                    />
                  )}
                </>
              )}
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
                  <Link
                    className="panel-link"
                    href={href(selected.version, before)}
                    prefetch={false}
                  >
                    Link to this version
                  </Link>{' '}
                  <Link
                    className="panel-link"
                    href={contextComparisonHref({
                      history: { ...current, version: selected.version },
                      from_version: selected.version,
                    })}
                    prefetch={false}
                  >
                    Compare this version
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
        {navigation && (
          <nav className="heading-actions" aria-label="Context history recovery">
            <HistoryRetry navigation={navigation} label="Retry history page" />
            <Link
              className="panel-link"
              href={contextHistoryHref({ ...navigation, before: undefined, version: undefined })}
              prefetch={false}
            >
              Latest recorded versions
            </Link>
            {navigation.return_href && (
              <Link className="panel-link" href={navigation.return_href} prefetch={false}>
                Back to results
              </Link>
            )}
          </nav>
        )}
        <Link className="panel-link" href="/context" prefetch={false}>
          Return to context
        </Link>
      </>
    );
  }
}

function HistoryRetry({
  navigation,
  label,
}: {
  navigation: ContextHistoryNavigation;
  label: string;
}) {
  const fields = new URLSearchParams(contextHistoryHref(navigation).split('?')[1]);
  return (
    <form action="/context/history" method="get">
      {Array.from(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button className="secondary-button" type="submit">
        {label}
      </button>
    </form>
  );
}
