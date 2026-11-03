import Link from 'next/link';
import { parseConflictRegistryQuery, type ConflictRegistryRecord } from '@planemem/contracts';
import { Icon } from '../../components/icons';
import { PageError, toneFor } from '../../components/page-state';
import { Badge, Panel } from '../../components/ui';
import { queryWorkbench } from '../../lib/server-api';
import { ConflictSelection } from './selection';
import { ConflictLookup } from './lookup';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ConflictsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  try {
    const params = await searchParams;
    if (
      Object.keys(params).some(
        (key) => !['q', 'status', 'type', 'conflict', 'cursor', 'item'].includes(key),
      ) ||
      Object.values(params).some((value) => value !== undefined && typeof value !== 'string')
    )
      throw new Error(
        'Use each conflict filter once. Restart from the first page when changing filters.',
      );
    const query = parseConflictRegistryQuery({
      ...(params.q === undefined ? {} : { query: params.q }),
      ...(params.status === undefined ? {} : { status: params.status }),
      ...(params.type === undefined ? {} : { entity_type: params.type }),
      ...(params.conflict === undefined ? {} : { conflict_id: params.conflict }),
      ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
    });
    const response = await queryWorkbench<ConflictRegistryRecord[]>('conflicts', { ...query });
    const conflicts = response.data;
    const open = conflicts.filter((row) => row.status === 'open').length;
    const filters = {
      ...(query.query ? { q: query.query } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.entity_type ? { type: query.entity_type } : {}),
      ...(query.conflict_id ? { conflict: query.conflict_id } : {}),
    };
    const position = { ...filters, ...(query.cursor ? { cursor: query.cursor } : {}) };
    const selectedId = typeof params.item === 'string' ? params.item : conflicts[0]?.conflict_id;
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Conflicts</h1>
            <p>Browse saved conflict metadata, then open a record to compare its values.</p>
          </div>
          <Badge tone={open ? 'red' : 'green'}>{open} open on this page</Badge>
        </div>
        <div className="status-card-grid">
          <Metric label="Records on this page" value={conflicts.length} tone="cyan" />
          <Metric label="Open on this page" value={open} tone={open ? 'red' : 'green'} />
          <Metric label="Resolved on this page" value={conflicts.length - open} tone="green" />
          <Metric
            label="Entities on this page"
            value={
              new Set(conflicts.map((row) => JSON.stringify([row.entity_type, row.entity_id]))).size
            }
            tone="purple"
          />
        </div>
        <form
          action="/conflicts"
          method="get"
          target="_blank"
          rel="noreferrer"
          className="filters work-item-filters"
          key={JSON.stringify(filters)}
        >
          <label className="filter-input">
            <Icon name="search" />
            <input
              type="search"
              name="q"
              aria-label="Search conflict metadata"
              maxLength={500}
              defaultValue={query.query ?? ''}
              placeholder="Entity, field, actor or trace"
            />
          </label>
          <select
            className="filter-chip"
            name="status"
            aria-label="Conflict status"
            defaultValue={query.status ?? ''}
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
          <input
            className="filter-chip"
            name="type"
            aria-label="Exact entity type"
            maxLength={255}
            defaultValue={query.entity_type ?? ''}
            placeholder="Exact entity type"
          />
          {query.conflict_id && <input type="hidden" name="conflict" value={query.conflict_id} />}
          <button className="secondary-button">Apply filters ↗</button>
          <Link
            className="panel-link"
            href="/conflicts"
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Clear filters ↗
          </Link>
        </form>
        <p className="muted">
          Search matches metadata literally and ignores ASCII letter case. Pages reflect current
          records. Filters, page links and record selection open in a new tab so an existing
          decision form stays open.
        </p>
        <div className="drawer-layout conflict-layout">
          <Panel title="Conflict directory" icon="conflicts">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Entity</th>
                    <th>Field</th>
                    <th>Versions</th>
                    <th>Status</th>
                    <th>Resolution</th>
                    <th>Record actor</th>
                  </tr>
                </thead>
                <tbody>
                  {conflicts.map((row) => (
                    <tr key={row.conflict_id}>
                      <td>
                        <Link
                          className="work-item-link table-title"
                          href={{
                            pathname: '/conflicts',
                            query: { ...position, item: row.conflict_id },
                          }}
                          target="_blank"
                          rel="noreferrer"
                          prefetch={false}
                          aria-current={selectedId === row.conflict_id ? 'true' : undefined}
                        >
                          <div>
                            <strong>{row.entity_type}</strong>
                            <small>{row.entity_id}</small>
                            <small>{row.conflict_id} ↗</small>
                          </div>
                        </Link>
                      </td>
                      <td>
                        {row.field}
                        <Link
                          className="panel-link"
                          prefetch={false}
                          target="_blank"
                          rel="noreferrer"
                          href={{
                            pathname: '/conflicts/detail',
                            query: { conflict: row.conflict_id },
                          }}
                        >
                          Independent details ↗
                        </Link>
                      </td>
                      <td>
                        base {row.base_version} · local {row.local_version} / server{' '}
                        {row.server_version}
                      </td>
                      <td>
                        <Badge tone={toneFor(row.status)}>{row.status}</Badge>
                      </td>
                      <td>{row.resolution ?? 'Not recorded'}</td>
                      <td>{row.actor_id ?? 'Not recorded'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!conflicts.length && (
                <div className="empty-state">
                  <h3>No records on this page for the current filters</h3>
                </div>
              )}
            </div>
            <div className="heading-actions">
              <Link
                className="secondary-button"
                href={{ pathname: '/conflicts', query: filters }}
                prefetch={false}
                target="_blank"
                rel="noreferrer"
              >
                First page ↗
              </Link>
              {response.has_more && response.next_cursor && (
                <Link
                  className="secondary-button"
                  href={{
                    pathname: '/conflicts',
                    query: { ...filters, cursor: response.next_cursor },
                  }}
                  prefetch={false}
                  target="_blank"
                  rel="noreferrer"
                >
                  Next page ↗
                </Link>
              )}
            </div>
            <p className="muted">Directory read trace · {response.trace_id}</p>
          </Panel>
          <Panel title="Selected conflict" icon="conflicts" className="drawer conflict-drawer">
            {selectedId !== undefined ? (
              <ConflictSelection
                id={selectedId}
                canResolve={response.conflict_permissions?.resolve === true}
                explicit={params.item === selectedId}
                position={position}
              />
            ) : (
              <div className="empty-state">
                <h3>Select a conflict</h3>
              </div>
            )}
          </Panel>
        </div>
        <ConflictLookup />
      </>
    );
  } catch (error) {
    return (
      <>
        <div className="page-heading">
          <h1>Conflicts</h1>
        </div>
        <PageError error={error} />
        <Link
          className="panel-link"
          href="/conflicts"
          prefetch={false}
          target="_blank"
          rel="noreferrer"
        >
          Restart conflict directory ↗
        </Link>
        <ConflictLookup />
      </>
    );
  }
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <section className="panel status-card">
      <small>{label}</small>
      <strong className={'text-' + tone}>{value}</strong>
    </section>
  );
}
