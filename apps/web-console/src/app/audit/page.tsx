import Link from 'next/link';
import {
  isUlid,
  parseWorkbenchAuditQuery,
  WORKBENCH_AUDIT_LIMIT,
  type WorkbenchAuditQuery,
  type WorkbenchAuditRecord,
  type WorkbenchAuditScope,
} from '@planemem/contracts';
import { PageError, toneFor } from '../../components/page-state';
import { Badge, Panel } from '../../components/ui';
import { queryWorkbench, type WorkbenchResponse } from '../../lib/server-api';
import { AuditRecordExport } from './export-controls';

type SearchParams = Record<string, string | string[] | undefined>;
const fields = [
  ['resource', 'Exact resource', 2048],
  ['trace_id', 'Exact trace ID', 512],
  ['action', 'Exact action', 256],
  ['audit_id', 'Exact audit ID', 26],
  ['session_id', 'Exact session ID', 26],
] as const;

function pageQuery(params: SearchParams) {
  if (
    Object.keys(params).some(
      (key) =>
        !['resource', 'trace_id', 'action', 'audit_id', 'session_id', 'item', 'cursor'].includes(
          key,
        ),
    )
  )
    throw new TypeError('Use only the audit filters shown below.');
  const values: Record<string, string> = {};
  for (const [key] of fields) {
    const value = params[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string') throw new TypeError('Each audit filter may appear only once.');
    values[key] = value;
  }
  if (params.cursor !== undefined) {
    if (typeof params.cursor !== 'string')
      throw new TypeError('The audit cursor may appear only once.');
    values.cursor = params.cursor;
  }
  const item = params.item;
  if (item !== undefined && item !== '' && !isUlid(item))
    throw new TypeError('The selected audit ID is invalid.');
  return {
    query: parseWorkbenchAuditQuery(values),
    item: typeof item === 'string' && item !== '' ? item : undefined,
  };
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  let query: WorkbenchAuditQuery = {};
  let selectedId: string | undefined;
  let response: WorkbenchResponse<WorkbenchAuditRecord[]> | undefined;
  let failure: unknown;
  try {
    const parsed = pageQuery(params);
    query = parsed.query;
    selectedId = parsed.item;
    response = await queryWorkbench<WorkbenchAuditRecord[]>('audit', { ...query });
  } catch (error) {
    failure = error;
  }
  const records = response?.data ?? [];
  const selected = selectedId ? records.find((row) => row.audit_id === selectedId) : records[0];
  const firstPageFilters = Object.fromEntries(
    fields.flatMap(([key]) => {
      const value = params[key];
      return typeof value === 'string' && value !== '' ? [[key, value]] : [];
    }),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Audit</h1>
          <p>Find visible records by resource, trace, action, audit ID or session.</p>
        </div>
        {response && <Badge tone="cyan">{records.length} shown</Badge>}
      </div>
      <Panel title="Audit filters" icon="audit">
        <form
          className="filters work-item-filters"
          action="/audit"
          method="get"
          key={JSON.stringify(params)}
        >
          {fields.map(([key, label, maximum]) => (
            <label className="filter-input" key={key}>
              <span>{label}</span>
              <input
                name={key}
                aria-label={label}
                maxLength={maximum}
                defaultValue={typeof params[key] === 'string' ? params[key] : ''}
              />
            </label>
          ))}
          <button className="secondary-button">Apply filters</button>
          <Link className="panel-link" href="/audit" prefetch={false}>
            Clear filters
          </Link>
        </form>
        <p className="muted">
          All supplied filters must match exactly. Results contain up to {WORKBENCH_AUDIT_LIMIT}{' '}
          visible records per page, newest first. Counts below describe this page only.
        </p>
        {query.session_id && (
          <p role="note">
            This filter matches the recorded session field. Older records and operations without
            that field are not included. A recorded request target or an allowed entry decision does
            not confirm that the session exists or that its command completed.
          </p>
        )}
        {params.cursor !== undefined && failure !== undefined && (
          <p>
            <Link
              className="panel-link"
              href={{ pathname: '/audit', query: firstPageFilters }}
              prefetch={false}
            >
              Restart from the newest matching records
            </Link>
          </p>
        )}
      </Panel>
      {failure !== undefined ? (
        <PageError error={failure} />
      ) : response ? (
        <>
          <div className="status-card-grid audit-metrics">
            <Status label="Shown" value={records.length} tone="cyan" />
            <Status
              label="Allowed"
              value={records.filter((row) => row.result === 'allowed').length}
              tone="green"
            />
            <Status
              label="Denied"
              value={records.filter((row) => row.result === 'denied').length}
              tone="yellow"
            />
            <Status
              label="Errors"
              value={records.filter((row) => row.result === 'error').length}
              tone="red"
            />
          </div>
          {(query.cursor !== undefined || response.next_cursor !== undefined) && (
            <div className="panel">
              <nav className="heading-actions" aria-label="Audit pages">
                {query.cursor !== undefined && (
                  <Link
                    className="secondary-button"
                    href={{ pathname: '/audit', query: firstPageFilters }}
                    prefetch={false}
                  >
                    Newest matching records
                  </Link>
                )}
                {response.next_cursor !== undefined && (
                  <Link
                    className="primary-button"
                    href={{ pathname: '/audit', query: { ...query, cursor: response.next_cursor } }}
                    prefetch={false}
                  >
                    Older matching records
                  </Link>
                )}
              </nav>
              <p role="status">
                {response.has_more
                  ? 'More visible matches were available when this page was read.'
                  : 'No further visible matches were found after this page.'}{' '}
                Each page rechecks access; new or changed records may alter later results.
              </p>
            </div>
          )}
          <div className="drawer-layout audit-layout">
            <Panel title="Matching records" icon="activity">
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Occurred</th>
                      <th>Action</th>
                      <th>Resource</th>
                      <th>Actor / client</th>
                      <th>Result</th>
                      <th>Classification</th>
                      <th>Trace</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => (
                      <tr key={record.audit_id}>
                        <td>{record.occurred_at}</td>
                        <td>
                          <Link
                            className="panel-link"
                            href={{
                              pathname: '/audit',
                              query: { ...query, item: record.audit_id },
                            }}
                            scroll={false}
                            prefetch={false}
                            aria-current={
                              selected?.audit_id === record.audit_id ? 'true' : undefined
                            }
                          >
                            {record.action}
                          </Link>
                        </td>
                        <td>{record.resource}</td>
                        <td>
                          <strong>{record.actor_id}</strong>
                          <small className="table-subline">{record.client_id}</small>
                        </td>
                        <td>
                          <Badge tone={toneFor(record.result)}>{record.result}</Badge>
                        </td>
                        <td>
                          <Badge>{record.classification}</Badge>
                        </td>
                        <td>
                          <FilterLink
                            query={{ trace_id: record.trace_id }}
                            label={record.trace_id}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {records.length === 0 && (
                  <div className="empty-state">
                    <h3>No matching visible records</h3>
                    <p>
                      Adjust the filters or return to the original project. This result does not
                      establish that an operation failed or that no audit record exists.
                    </p>
                  </div>
                )}
              </div>
            </Panel>
            <Panel title="Selected record" icon="audit" className="drawer audit-drawer">
              {selected ? (
                <AuditDetail record={selected} scope={response.scope} />
              ) : (
                <div className="empty-state">
                  <h3>
                    {selectedId ? 'Selected record not in these results' : 'No record selected'}
                  </h3>
                  <p>
                    Selection never falls back to another record. Use an exact audit ID to look it
                    up with the current permissions.
                  </p>
                  {selectedId && (
                    <FilterLink query={{ audit_id: selectedId }} label="Look up this audit ID" />
                  )}
                </div>
              )}
            </Panel>
          </div>
          <p className="muted">
            Query trace: {response.trace_id}. Restricted records require the corresponding read
            permission. Missing observations do not prove whether a client received or saved a file.
          </p>
        </>
      ) : null}
    </>
  );
}

function FilterLink({ query, label }: { query: WorkbenchAuditQuery; label: string }) {
  try {
    parseWorkbenchAuditQuery(query);
  } catch {
    return <span>{label}</span>;
  }
  return (
    <Link
      className="panel-link"
      href={{ pathname: '/audit', query: { ...query } }}
      prefetch={false}
    >
      {label}
    </Link>
  );
}

function AuditDetail({
  record,
  scope,
}: {
  record: WorkbenchAuditRecord;
  scope: WorkbenchAuditScope | undefined;
}) {
  const download = record.action.startsWith('artifact.download.');
  return (
    <div className="side-detail audit-detail">
      <div className="selected-session-header">
        <div>
          <h2>{record.action}</h2>
          <small>{record.audit_id}</small>
        </div>
        <Badge tone={toneFor(record.result)}>{record.result}</Badge>
      </div>
      <div className="drawer-badges">
        <Badge>{record.classification}</Badge>
        <Badge tone="cyan">{record.client_id}</Badge>
      </div>
      <div className="detail-grid">
        <div>
          <small>Occurred</small>
          <strong>{record.occurred_at}</strong>
        </div>
        <div>
          <small>Actor</small>
          <strong>{record.actor_id}</strong>
        </div>
        <div>
          <small>Resource</small>
          <FilterLink query={{ resource: record.resource }} label={record.resource} />
        </div>
        <div>
          <small>Session</small>
          {record.session_id ? (
            <FilterLink query={{ session_id: record.session_id }} label={record.session_id} />
          ) : (
            <strong>Not recorded</strong>
          )}
        </div>
      </div>
      {download && (
        <p role="note">
          A release record permits the server to send content. A finished transport record only
          describes the server response. Neither confirms that the client received or saved the
          file.
        </p>
      )}
      <h3 className="detail-section-title">Trace and references</h3>
      <div className="source-line">
        <span>Trace ID</span>
        <strong>{record.trace_id}</strong>
      </div>
      <div className="heading-actions detail-actions">
        <FilterLink query={{ trace_id: record.trace_id }} label="Open this trace" />
        <FilterLink query={{ action: record.action }} label="Find this action" />
        {isUlid(record.session_id) && (
          <Link
            className="panel-link"
            href={{ pathname: '/sessions/detail', query: { session: record.session_id } }}
            prefetch={false}
          >
            Read this session
          </Link>
        )}
      </div>
      {record.session_id && record.resource === `runtime:${record.action}` && (
        <p role="note">
          This entry records a policy decision for the requested session. An allowed decision does
          not confirm the operation result. To recover a write, use its original command receipt.
        </p>
      )}
      {record.source_refs_state === 'too-large' ? (
        <p role="note">
          Source references were not included because their stored JSON is too large for this view (
          {record.source_refs_bytes} bytes). This does not mean that no references were recorded.
        </p>
      ) : record.source_refs.length ? (
        <ul>
          {record.source_refs.map((ref, index) => (
            <li key={index}>
              <strong>{ref.type}: </strong>
              {ref.type === 'audit' && isUlid(ref.id) ? (
                <FilterLink query={{ audit_id: ref.id }} label={ref.id} />
              ) : (
                <span>{ref.id}</span>
              )}
              {ref.revision !== undefined && <span> · revision {ref.revision}</span>}
              {ref.uri && <div className="muted">{ref.uri}</div>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No source references were recorded.</p>
      )}
      {record.details_state === 'too-large' ? (
        <p role="note">
          Recorded details were not included because their stored JSON is too large for this view (
          {record.details_bytes} bytes). The saved audit record has not been changed.
        </p>
      ) : (
        <details>
          <summary>Recorded details JSON</summary>
          <pre className="json-view">{JSON.stringify(record.details)}</pre>
        </details>
      )}
      {scope && <AuditRecordExport scope={scope} record={record} />}
    </div>
  );
}

function Status({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <section className="panel status-card">
      <small>{label}</small>
      <strong className={'text-' + tone}>{value}</strong>
      <div className="muted">In these results</div>
    </section>
  );
}
