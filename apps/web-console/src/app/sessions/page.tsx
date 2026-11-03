import Link from 'next/link';
import {
  parseSessionResumeOrigin,
  parseSessionClosureState,
  parseSessionRegistryQuery,
  SESSION_REGISTRY_STATUSES,
  isUlid,
  type SessionRegistryRecord,
  type SessionResumeOrigin,
  type SessionClosureState,
  type SessionCommandIdentity,
} from '@planemem/contracts';
import { Icon } from '../../components/icons';
import { PageError, numberValue, textValue, toneFor } from '../../components/page-state';
import { Badge, Panel } from '../../components/ui';
import { queryWorkbench } from '../../lib/server-api';
import { StartSessionForm } from './forms';
import { CheckpointForm } from './checkpoint-form';
import { CheckpointHistory } from './history';
import { EndSessionForm } from './end-form';
import { SessionLookup } from './lookup';

const isLive = (status: unknown) => status === 'running' || status === 'paused';
export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const params = await searchParams;
    const { item, q, status, client, history, before } = params;
    const filters = parseSessionRegistryQuery({
      query: q ?? '',
      status: status ?? '',
      client_id: client ?? '',
      limit: 25,
      ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
    });
    const response = await queryWorkbench<SessionRegistryRecord[]>('sessions', { ...filters });
    const sessions = response.data ?? [];
    const canWrite = response.session_permissions?.write_sessions === true;
    const active = sessions.filter((session) => isLive(session.status)).length;
    const ended = sessions.filter((session) =>
      ['ended', 'abandoned'].includes(session.status),
    ).length;
    const failed = sessions.filter((session) => session.status === 'failed').length;
    const totalRuns = sessions.reduce((sum, item) => sum + BigInt(item.run_count), 0n).toString();
    const totalTools = sessions
      .reduce((sum, item) => sum + BigInt(item.tool_call_count), 0n)
      .toString();
    const cursor = typeof before === 'string' ? Number(before) : 0;
    const query = filters.query ?? '';
    const statusFilter = filters.status ?? '';
    const clientFilter = filters.client_id ?? '';
    const filterParams = {
      ...(query ? { q: query } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(clientFilter ? { client: clientFilter } : {}),
    };
    const pageParams = { ...filterParams, ...(filters.cursor ? { cursor: filters.cursor } : {}) };
    const visible = sessions;
    const selected =
      item === undefined ? visible[0] : sessions.find((session) => session.session_id === item);
    const selectedState = selected
      ? parseSessionClosureState(
          {
            session_id: selected.session_id,
            status: selected.status,
            version: Number(selected.version),
            ended_at: selected.ended_at,
          },
          String(selected.session_id),
        )
      : undefined;

    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Sessions</h1>
            <p>Cross-client runs, tool calls, checkpoints and parent-child session lineage.</p>
          </div>
          <div className="heading-actions">
            <Badge tone="green">{sessions.length} sessions on this page</Badge>
          </div>
        </div>
        <div className="status-card-grid">
          <Status
            label="Live sessions on page"
            value={active}
            tone="green"
            hint="running or paused"
          />
          <Status
            label="Agent runs on page"
            value={totalRuns}
            tone="cyan"
            hint="recorded for these sessions"
          />
          <Status
            label="Tool calls on page"
            value={totalTools}
            tone="purple"
            hint="recorded for these sessions"
          />
          <Status
            label="Ended / failed on page"
            value={ended + failed}
            tone={failed ? 'red' : 'blue'}
            hint={ended + ' ended · ' + failed + ' failed'}
          />
        </div>
        <Panel title="Start or recover a session" icon="sessions">
          <StartSessionForm
            key={JSON.stringify(response.session_identity ?? null)}
            initialKey={crypto.randomUUID()}
            identity={response.session_identity}
            canWrite={canWrite}
          />
        </Panel>
        <SessionLookup />
        <Panel title="Session registry" icon="sessions" className="session-toolbar-panel">
          <form
            className="filters work-item-filters"
            action="/sessions"
            method="get"
            key={JSON.stringify(filterParams)}
          >
            <label className="filter-input">
              <Icon name="search" />
              <input
                type="search"
                aria-label="Search sessions"
                name="q"
                placeholder="Session, client, actor or trace"
                defaultValue={query}
                maxLength={500}
              />
            </label>
            <input
              name="client"
              aria-label="Exact client ID"
              placeholder="Exact client ID"
              className="filter-chip"
              defaultValue={clientFilter}
              maxLength={1024}
            />
            <select
              name="status"
              aria-label="Filter by status"
              className="filter-chip"
              defaultValue={statusFilter}
            >
              <option value="">All statuses</option>
              {SESSION_REGISTRY_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <button className="secondary-button">Apply filters</button>
            {(query || clientFilter || statusFilter) && (
              <Link href="/sessions" className="panel-link" prefetch={false}>
                Clear filters
              </Link>
            )}
          </form>
          <p className="muted">
            Filters apply to the project before paging. Cards summarize only this page. Each page is
            a new read; session state and visibility may change between reads.
          </p>
          <nav className="heading-actions" aria-label="Session pages">
            <Link
              className="panel-link"
              href={{ pathname: '/sessions', query: filterParams }}
              prefetch={false}
            >
              First page
            </Link>
            {response.next_cursor && (
              <Link
                className="panel-link"
                href={{
                  pathname: '/sessions',
                  query: { ...filterParams, cursor: response.next_cursor },
                }}
                prefetch={false}
              >
                Next page
              </Link>
            )}
          </nav>
        </Panel>
        <div className="drawer-layout sessions-layout">
          <Panel title="Session registry" icon="database">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Status</th>
                    <th>Actor</th>
                    <th>Runs</th>
                    <th>Tools</th>
                    <th>Started</th>
                    <th>Trace</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((session) => (
                    <tr key={String(session.session_id)}>
                      <td>
                        <Link
                          className="work-item-link table-title"
                          href={{
                            pathname: '/sessions',
                            query: { ...pageParams, item: String(session.session_id) },
                          }}
                          prefetch={false}
                          scroll={false}
                          aria-current={selected === session ? 'true' : undefined}
                        >
                          <Icon name="sessions" />
                          <div>
                            <strong>{textValue(session.client_id)}</strong>
                            <small>{textValue(session.session_id).slice(0, 18)}…</small>
                          </div>
                        </Link>
                      </td>
                      <td>
                        <Badge tone={toneFor(session.status)}>{textValue(session.status)}</Badge>
                      </td>
                      <td>{textValue(session.actor_id)}</td>
                      <td>{numberValue(session.run_count)}</td>
                      <td>{numberValue(session.tool_call_count)}</td>
                      <td>{textValue(session.started_at)}</td>
                      <td className="muted">{textValue(session.trace_id).slice(0, 15)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visible.length && (
                <div className="empty-state">
                  <h3>No matching sessions on this page</h3>
                </div>
              )}
            </div>
          </Panel>
          <Panel title="Selected session" icon="clock" className="drawer session-drawer">
            {selected && selectedState ? (
              <SessionDetail
                key={JSON.stringify([response.session_identity, selected.session_id])}
                session={selected}
                closureState={selectedState}
                identity={response.session_identity}
                canWrite={canWrite}
                showHistory={history === '1'}
                before={Number.isSafeInteger(cursor) && cursor > 0 ? cursor : undefined}
                refreshHref={
                  '/sessions?' +
                  new URLSearchParams({
                    ...pageParams,
                    item: String(selected.session_id),
                    ...(history === '1' ? { history: '1' } : {}),
                    ...(Number.isSafeInteger(cursor) && cursor > 0
                      ? { before: String(cursor) }
                      : {}),
                  }).toString()
                }
              />
            ) : (
              <div className="empty-state">
                <h3>{item ? 'Session is not on this page' : 'Select a session'}</h3>
                {isUlid(item) && (
                  <Link
                    className="panel-link"
                    href={{ pathname: '/sessions/detail', query: { session: item } }}
                    prefetch={false}
                  >
                    Read selected session by ID
                  </Link>
                )}
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
          <div>
            <h1>Sessions</h1>
            <p>Cross-client runs, tool calls, checkpoints and parent-child session lineage.</p>
          </div>
        </div>
        <PageError error={error} />
        <Link className="panel-link" href="/sessions" prefetch={false}>
          Restart from the first page
        </Link>
        <SessionLookup />
      </>
    );
  }
}

function SessionDetail({
  session,
  closureState,
  identity,
  canWrite,
  showHistory,
  before,
  refreshHref,
}: {
  session: SessionRegistryRecord;
  closureState: SessionClosureState;
  identity?: SessionCommandIdentity;
  canWrite: boolean;
  showHistory: boolean;
  before?: number;
  refreshHref: string;
}) {
  const runs = numberValue(session.run_count);
  const tools = numberValue(session.tool_call_count);
  let origin: SessionResumeOrigin | undefined;
  try {
    if (session.resume_origin != null) origin = parseSessionResumeOrigin(session.resume_origin);
  } catch {
    /* A malformed historical origin must not become a navigation target. */
  }
  return (
    <div className="session-detail side-detail">
      <div className="selected-session-header">
        <div className="selected-session-icon">
          <Icon name="sessions" />
        </div>
        <div>
          <h2>{textValue(session.client_id)} session</h2>
          <small>{textValue(session.session_id)}</small>
        </div>
        <Badge tone={toneFor(session.status)}>{textValue(session.status)}</Badge>
      </div>
      <div className="drawer-badges">
        <Badge tone="cyan">{textValue(session.actor_id)}</Badge>
        <Badge tone="neutral">{textValue(session.trace_id).slice(0, 18)}…</Badge>
      </div>
      <div className="detail-grid">
        <div>
          <small>Parent session</small>
          <strong>{textValue(session.parent_session_id, 'Root session')}</strong>
        </div>
        <div>
          <small>Started</small>
          <strong>{textValue(session.started_at)}</strong>
        </div>
        <div>
          <small>Version</small>
          <strong>{session.version == null ? 'Unavailable' : String(session.version)}</strong>
        </div>
        <div>
          <small>Closed</small>
          <strong>{textValue(session.ended_at, 'Not closed')}</strong>
        </div>
        <div>
          <small>Agent runs</small>
          <strong>{runs}</strong>
        </div>
        <div>
          <small>Tool calls</small>
          <strong>{tools}</strong>
        </div>
      </div>
      <hr />
      {origin && (
        <p>
          Resumed from{' '}
          <Link
            className="panel-link"
            href={{ pathname: '/handoffs/detail', query: { handoff: origin.handoff_id } }}
            target="_blank"
            rel="noreferrer"
          >
            handoff {origin.handoff_id}
          </Link>
          <small> · Checkpoint {origin.checkpoint_id}</small>
          {typeof session.parent_session_id === 'string' && (
            <Link
              className="panel-link"
              target="_blank"
              rel="noreferrer"
              href={{
                pathname: '/sessions/checkpoint',
                query: { session: session.parent_session_id, checkpoint: origin.checkpoint_id },
              }}
            >
              Read original checkpoint ↗
            </Link>
          )}
        </p>
      )}
      <h3 className="detail-section-title">Recorded activity</h3>
      <Link
        className="panel-link"
        href={{ pathname: '/sessions/detail', query: { session: String(session.session_id) } }}
        target="_blank"
        rel="noreferrer"
        prefetch={false}
      >
        Open session state and recovery ↗
      </Link>
      <Link
        className="panel-link"
        href={{ pathname: '/sessions/activity', query: { session: String(session.session_id) } }}
        target="_blank"
        rel="noreferrer"
      >
        Browse runs and tool calls
      </Link>
      <div className="run-timeline">
        <div className="run-event">
          <i className="timeline-dot done" />
          <div>
            <strong>Session created</strong>
            <small>{textValue(session.started_at)} · actor scope established</small>
          </div>
          <Badge tone="green">ok</Badge>
        </div>
        <div className="run-event">
          <i className="timeline-dot current" />
          <div>
            <strong>
              {runs
                ? runs + ' agent run' + (runs === 1 ? '' : 's') + ' observed'
                : 'Awaiting agent run'}
            </strong>
            <small>Open activity to read individual runs and their recorded status.</small>
          </div>
          <Badge tone="cyan">{runs}</Badge>
        </div>
        <div className="run-event">
          <i className="timeline-dot" />
          <div>
            <strong>
              {tools
                ? tools + ' tool call' + (tools === 1 ? '' : 's') + ' recorded'
                : 'No tool calls recorded'}
            </strong>
            <small>Tool activity is scoped to this session</small>
          </div>
          <Badge tone={tools ? 'purple' : 'neutral'}>{tools}</Badge>
        </div>
      </div>
      <div className="source-line">
        <span>Trace ID</span>
        <strong>{textValue(session.trace_id)}</strong>
      </div>
      <hr />
      <h3 className="detail-section-title">Checkpoints</h3>
      {typeof session.checkpoint_id === 'string' ? (
        <>
          <p>
            Latest revision {numberValue(session.checkpoint_revision)} · {session.checkpoint_id}
          </p>
          <Link
            className="panel-link"
            target="_blank"
            rel="noreferrer"
            href={{
              pathname: '/sessions/checkpoint',
              query: { session: String(session.session_id), checkpoint: session.checkpoint_id },
            }}
          >
            Open this checkpoint ↗
          </Link>
          {showHistory ? (
            <CheckpointHistory
              session={String(session.session_id)}
              before={before}
              canWrite={canWrite}
            />
          ) : (
            <Link
              className="panel-link"
              target="_blank"
              rel="noreferrer"
              prefetch={false}
              href={{
                pathname: '/sessions/history',
                query: { session: String(session.session_id) },
              }}
            >
              View checkpoint history ↗
            </Link>
          )}
          {canWrite && (
            <Link
              className="panel-link"
              target="_blank"
              rel="noreferrer"
              href={{
                pathname: '/handoffs/create',
                query: { session: String(session.session_id), checkpoint: session.checkpoint_id },
              }}
            >
              Hand off latest checkpoint ↗
            </Link>
          )}
        </>
      ) : (
        <p>No checkpoint recorded.</p>
      )}
      <CheckpointForm
        initial={closureState}
        identity={identity}
        canWrite={canWrite}
        initialKey={crypto.randomUUID()}
      />
      <EndSessionForm
        initial={closureState}
        identity={identity}
        canWrite={canWrite}
        initialKey={crypto.randomUUID()}
        refreshHref={refreshHref}
      />
      <div className="heading-actions detail-actions">
        {typeof session.parent_session_id === 'string' && (
          <Link
            className="panel-link"
            href={{ pathname: '/sessions/detail', query: { session: session.parent_session_id } }}
            prefetch={false}
          >
            Open parent session
          </Link>
        )}
        <Link
          className="panel-link"
          href={{ pathname: '/audit', query: { session_id: String(session.session_id) } }}
          prefetch={false}
        >
          Open audit
        </Link>
      </div>
    </div>
  );
}

function Status({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number | string;
  tone: string;
  hint: string;
}) {
  return (
    <section className="panel status-card">
      <small>{label}</small>
      <strong className={'text-' + tone}>{value}</strong>
      <div className="muted">{hint} · current page</div>
    </section>
  );
}
