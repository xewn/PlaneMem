import Link from 'next/link';
import {
  isUlid,
  parseHandoffRegistryQuery,
  handoffRegistryPending,
  type HandoffRegistryEnvelope,
} from '@planemem/contracts';
import { Icon } from '../../components/icons';
import { PageError, textValue, toneFor } from '../../components/page-state';
import { Badge, Panel } from '../../components/ui';
import { queryAuditPreview, queryWorkbench, getWorkbenchOverview } from '../../lib/server-api';
import { CheckpointPicker } from './checkpoint-picker';
import { HandoffDetail } from './detail';
import { HandoffLookup } from './lookup';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function HandoffsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  try {
    const params = await searchParams;
    const creating = params.create === '1';
    const filters = parseHandoffRegistryQuery({
      query: params.q ?? '',
      status: params.status ?? '',
      origin: params.origin ?? '',
      limit: 25,
      ...(params.session === undefined || params.session === ''
        ? {}
        : { session_id: params.session }),
      ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
    });
    const query = filters.query ?? '';
    const filter = filters.status ?? '';
    const [handoffRead, summaryRead, auditRead] = await Promise.allSettled([
      queryWorkbench<HandoffRegistryEnvelope['data']>('handoffs', { ...filters }),
      getWorkbenchOverview(),
      queryAuditPreview(),
    ]);
    if (handoffRead.status === 'rejected') throw handoffRead.reason;
    const handoffResponse = handoffRead.value;
    const handoffs = handoffResponse.data;
    const canWrite = handoffResponse.handoff_permissions?.write_sessions === true;
    const canClaim = handoffResponse.handoff_permissions?.claim === true;
    const visible = handoffs;
    const selected =
      params.item === undefined
        ? visible[0]
        : handoffs.find((row) => row.handoff_id === params.item);
    const filterParams = {
      ...(query ? { q: query } : {}),
      ...(filter ? { status: filter } : {}),
      ...(filters.session_id ? { session: filters.session_id } : {}),
      ...(filters.origin ? { origin: filters.origin } : {}),
    };
    const pageParams = { ...filterParams, ...(filters.cursor ? { cursor: filters.cursor } : {}) };
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Handoffs</h1>
            <p>Continue work across AI clients with explicit ownership and resumable context.</p>
          </div>
          <div className="heading-actions">
            <Badge tone="cyan">{handoffs.length} handoffs on this page</Badge>
            {handoffResponse.session_identity && (
              <Link
                className="primary-button"
                href={{ pathname: '/handoffs', query: { ...pageParams, create: '1' } }}
                prefetch={false}
              >
                <Icon name="handoffs" /> {canWrite ? 'Create handoff' : 'Recover handoff creation'}
              </Link>
            )}
          </div>
        </div>
        <div className="status-card-grid">
          <Metric
            label="Pending handoffs on page"
            value={handoffs.filter(handoffRegistryPending).length}
            tone="yellow"
          />
          <Metric
            label="Open conflicts"
            value={
              summaryRead.status === 'fulfilled'
                ? summaryRead.value.data.open_conflicts
                : 'Unavailable'
            }
            tone="red"
            failure={summaryRead.status === 'rejected' ? summaryRead : undefined}
          />
          <Metric
            label="Context items"
            value={
              summaryRead.status === 'fulfilled'
                ? summaryRead.value.data.total_context_items
                : 'Unavailable'
            }
            tone="cyan"
            hint="Visible, non-archived records"
            failure={summaryRead.status === 'rejected' ? summaryRead : undefined}
          />
          <Metric
            label="Audit events shown"
            value={
              auditRead.status === 'fulfilled'
                ? (auditRead.value?.data.length ?? 'Restricted')
                : 'Unavailable'
            }
            tone="purple"
            failure={auditRead.status === 'rejected' ? auditRead : undefined}
          />
        </div>
        <p className="muted">
          The queue shows one filtered page. Project counts and audit preview are separate reads. A
          failed summary does not mean there are no records; page counts are not project totals.
        </p>
        <HandoffLookup />
        <form
          className="filters work-item-filters"
          action="/handoffs"
          method="get"
          key={JSON.stringify(filterParams)}
        >
          <label className="filter-input">
            <Icon name="search" />
            <input
              name="q"
              type="search"
              aria-label="Search handoffs"
              defaultValue={query}
              placeholder="Checkpoint or recipient"
              maxLength={500}
            />
          </label>
          <select
            className="filter-chip"
            name="status"
            defaultValue={filter}
            aria-label="Handoff status"
          >
            <option value="">All statuses</option>
            <option value="open">Pending</option>
            <option value="closed">History</option>
          </select>
          <input
            name="session"
            className="filter-chip"
            aria-label="Exact session ID"
            placeholder="Exact session ID"
            defaultValue={filters.session_id ?? ''}
            maxLength={26}
            pattern="[0-9A-HJKMNP-TV-Z]{26}"
          />
          <select
            name="origin"
            className="filter-chip"
            aria-label="Handoff source"
            defaultValue={filters.origin ?? ''}
          >
            <option value="">All sources</option>
            <option value="session">Saved handoffs</option>
            <option value="projection">Historical projections</option>
          </select>
          <button className="secondary-button">Apply filters</button>
          {(query || filter || filters.session_id || filters.origin) && (
            <Link className="panel-link" href="/handoffs" prefetch={false}>
              Clear filters
            </Link>
          )}
        </form>
        <nav className="heading-actions" aria-label="Handoff pages">
          <Link
            className="panel-link"
            href={{ pathname: '/handoffs', query: filterParams }}
            prefetch={false}
          >
            First page
          </Link>
          {handoffResponse.next_cursor && (
            <Link
              className="panel-link"
              href={{
                pathname: '/handoffs',
                query: { ...filterParams, cursor: handoffResponse.next_cursor },
              }}
              prefetch={false}
            >
              Next page
            </Link>
          )}
        </nav>
        <p className="muted">
          Each page is a new read. Changing filters starts again; ownership and visibility can
          change between pages. Historical projections are view only.
        </p>
        <div className="drawer-layout handoff-layout">
          <Panel title="Handoff queue" icon="handoffs">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Checkpoint</th>
                    <th>Status</th>
                    <th>Offered to</th>
                    <th>Summary</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const id = String(row.handoff_id);
                    return (
                      <tr key={id}>
                        <td>
                          <Link
                            className="work-item-link table-title"
                            href={{ pathname: '/handoffs', query: { ...pageParams, item: id } }}
                            scroll={false}
                            prefetch={false}
                            aria-current={!creating && selected === row ? 'true' : undefined}
                          >
                            <Icon name="context" />
                            <div>
                              <strong>{id}</strong>
                              <small>{textValue(row.checkpoint_id)}</small>
                            </div>
                          </Link>
                        </td>
                        <td>
                          <Badge tone={toneFor(row.status)}>{textValue(row.status)}</Badge>
                          {row.origin === 'session' && (
                            <p>
                              <Link
                                className="panel-link"
                                target="_blank"
                                rel="noreferrer"
                                href={{ pathname: '/handoffs/detail', query: { handoff: id } }}
                              >
                                Open details ↗
                              </Link>
                            </p>
                          )}
                        </td>
                        <td>{textValue(row.offered_to, 'Any client')}</td>
                        <td>
                          {row.summary_state === 'too-large'
                            ? 'Summary omitted: exceeds the directory limit'
                            : row.summary_state === 'missing'
                              ? 'No summary recorded'
                              : textValue(row.summary)}
                        </td>
                        <td>{textValue(row.updated_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!visible.length && (
                <div className="empty-state">
                  <h3>No matching handoffs on this page</h3>
                </div>
              )}
            </div>
          </Panel>
          <Panel
            title={creating ? 'Create handoff' : 'Checkpoint detail'}
            icon="context"
            className="drawer handoff-drawer"
          >
            {creating ? (
              <CheckpointPicker
                queryText={params.checkpointQuery}
                checkpointId={params.checkpoint}
                cursor={params.checkpointCursor}
                pageParams={pageParams}
                scope={handoffResponse.scope}
                identity={handoffResponse.session_identity}
                canWrite={canWrite}
              />
            ) : selected ? (
              <HandoffDetail
                key={JSON.stringify([
                  handoffResponse.session_identity,
                  selected.session_id,
                  selected.handoff_id,
                  selected.checkpoint_id,
                ])}
                handoff={{ ...selected }}
                canWrite={canWrite}
                canClaim={canClaim}
                identity={handoffResponse.session_identity}
                canResume={handoffResponse.session_permissions?.write_sessions === true}
              />
            ) : (
              <div className="empty-state">
                {params.item !== undefined && <p>The selected handoff is not on this page.</p>}
                {isUlid(params.item) && (
                  <Link
                    className="panel-link"
                    href={{ pathname: '/handoffs/detail', query: { handoff: params.item } }}
                    prefetch={false}
                  >
                    Read saved handoff by ID
                  </Link>
                )}
                <p>
                  {canWrite
                    ? 'Select a handoff or create one from a session checkpoint.'
                    : 'Select a handoff to view its details.'}
                </p>
              </div>
            )}
          </Panel>
        </div>
      </>
    );
  } catch (error) {
    return (
      <>
        <div className="page-heading">
          <h1>Handoffs</h1>
        </div>
        <PageError error={error} />
        <Link className="panel-link" href="/handoffs" prefetch={false}>
          Restart from the first page
        </Link>
        <HandoffLookup />
      </>
    );
  }
}

function Metric({
  label,
  value,
  tone,
  hint,
  failure,
}: {
  label: string;
  value: number | string;
  tone: string;
  hint?: string;
  failure?: PromiseRejectedResult;
}) {
  return (
    <section className="panel status-card">
      <small>{label}</small>
      <strong className={'text-' + tone}>{value}</strong>
      {hint && <small>{hint}</small>}
      {failure && (
        <details>
          <summary>Read error</summary>
          <PageError error={failure.reason} />
        </details>
      )}
    </section>
  );
}
