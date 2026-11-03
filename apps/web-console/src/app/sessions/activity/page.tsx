import Link from 'next/link';
import {
  isUlid,
  parseSessionRunQuery,
  parseSessionToolCallQuery,
  type SourceRef,
} from '@planemem/contracts';
import { PageError, toneFor } from '../../../components/page-state';
import { Badge, Panel } from '../../../components/ui';
import { listWorkbenchSessionRuns, listWorkbenchSessionToolCalls } from '../../../lib/server-api';

export default async function SessionActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const params = await searchParams;
    if (!isUlid(params.session)) throw new Error('Select a session to read its activity.');
    const sessionId = params.session;
    const view = params.view ?? 'runs';
    if (view !== 'runs' && view !== 'tools') throw new Error('Choose runs or tool calls.');
    const allowed =
      view === 'runs'
        ? ['session', 'view', 'before_sequence', 'limit']
        : ['session', 'view', 'run_id', 'before_id', 'limit'];
    const filters: Record<string, unknown> = { limit: 25 };
    for (const [key, value] of Object.entries(params)) {
      if (!allowed.includes(key) || typeof value !== 'string')
        throw new Error('Invalid activity filters.');
      if (key === 'session' || key === 'view') continue;
      if (key === 'limit' || key === 'before_sequence') {
        if (!/^\d+$/.test(value))
          throw new Error('Page size and sequence must be positive integers.');
        filters[key] = Number(value);
      } else filters[key] = value;
    }
    const query =
      view === 'runs' ? parseSessionRunQuery(filters) : parseSessionToolCallQuery(filters);
    const result =
      view === 'runs'
        ? await listWorkbenchSessionRuns(sessionId, query)
        : await listWorkbenchSessionToolCalls(sessionId, query);
    const page = result.data;
    const href = (next: Record<string, string | number> = {}) => ({
      pathname: '/sessions/activity',
      query: {
        session: sessionId,
        view,
        limit: query.limit,
        ...('run_id' in page && page.run_id ? { run_id: page.run_id } : {}),
        ...next,
      },
    });
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Session activity</h1>
            <p>
              {sessionId} · Session version {page.session.version}
            </p>
          </div>
          <Badge tone={page.session.status === 'failed' ? 'red' : toneFor(page.session.status)}>
            {page.session.status}
          </Badge>
        </div>
        <nav className="heading-actions" aria-label="Session activity views">
          <Link
            className="panel-link"
            target="_blank"
            rel="noreferrer"
            href={{
              pathname: '/sessions/activity/create',
              query: { session: sessionId, operation: 'run.start' },
            }}
          >
            Start a run ↗
          </Link>
          {'run_id' in page && page.run_id && (
            <Link
              className="panel-link"
              target="_blank"
              rel="noreferrer"
              href={{
                pathname: '/sessions/activity/create',
                query: { session: sessionId, operation: 'tool.call', run: page.run_id },
              }}
            >
              Record a tool call ↗
            </Link>
          )}
          <Link
            className="panel-link"
            href={{ pathname: '/sessions/detail', query: { session: sessionId } }}
          >
            Session state and recovery
          </Link>
          <Link
            className="panel-link"
            href={{ pathname: '/sessions/activity', query: { session: sessionId, view: 'runs' } }}
          >
            Runs
          </Link>
          <Link
            className="panel-link"
            href={{ pathname: '/sessions/activity', query: { session: sessionId, view: 'tools' } }}
          >
            All tool calls
          </Link>
        </nav>
        <p className="muted">
          These are recorded states. Closing a session does not change its run or tool records.
        </p>
        <Panel title={'runs' in page ? 'Runs by sequence' : 'Tool call records'} icon="sessions">
          <div className="session-activity-list">
            {'runs' in page ? (
              <>
                {!page.runs.length && <p>No runs on this page.</p>}
                {page.runs.map((run) => (
                  <article className="session-activity-record" key={run.run_id}>
                    <div className="heading-actions">
                      <strong>
                        Run {run.sequence} · {run.model || 'Model not recorded'}
                      </strong>
                      <Badge tone={run.status === 'failed' ? 'red' : toneFor(run.status)}>
                        {run.status}
                      </Badge>
                    </div>
                    <RecordInfo
                      id={run.run_id}
                      version={run.version}
                      trace={run.trace_id}
                      sources={run.source_refs}
                    />
                    <Link
                      className="panel-link"
                      target="_blank"
                      rel="noreferrer"
                      href={{
                        pathname: '/sessions/activity/run',
                        query: { session: sessionId, run: run.run_id },
                      }}
                    >
                      Open run details ↗
                    </Link>
                    <Link
                      className="panel-link"
                      href={{
                        pathname: '/sessions/activity',
                        query: { session: sessionId, view: 'tools', run_id: run.run_id },
                      }}
                    >
                      View this run’s tool calls
                    </Link>
                  </article>
                ))}
              </>
            ) : (
              <>
                <p>Sorted by record ID. Execution timestamps are not available in these records.</p>
                {page.run_id && <p>Run filter: {page.run_id}</p>}
                {!page.tool_calls.length && <p>No tool calls on this page.</p>}
                {page.tool_calls.map((call) => (
                  <article className="session-activity-record" key={call.tool_call_id}>
                    <div className="heading-actions">
                      <strong>{call.tool_name}</strong>
                      <Badge
                        tone={
                          call.status === 'failed'
                            ? 'red'
                            : call.status === 'succeeded'
                              ? 'green'
                              : 'cyan'
                        }
                      >
                        {call.status}
                      </Badge>
                    </div>
                    <p>Run {call.run_id}</p>
                    <RecordInfo
                      id={call.tool_call_id}
                      version={call.version}
                      trace={call.trace_id}
                      sources={call.source_refs}
                    />
                    <Link
                      className="panel-link"
                      target="_blank"
                      rel="noreferrer"
                      href={{
                        pathname: '/sessions/activity/tool',
                        query: { session: sessionId, tool: call.tool_call_id },
                      }}
                    >
                      Open tool call details ↗
                    </Link>
                    {!page.run_id && (
                      <Link
                        className="panel-link"
                        href={{
                          pathname: '/sessions/activity',
                          query: { session: sessionId, view: 'tools', run_id: call.run_id },
                        }}
                      >
                        Show this run only
                      </Link>
                    )}
                  </article>
                ))}
              </>
            )}
            <nav className="heading-actions" aria-label="Activity pages">
              {(params.before_sequence || params.before_id) && (
                <Link className="panel-link" href={href()}>
                  First page
                </Link>
              )}
              {'runs' in page && page.next_before_sequence !== undefined && (
                <Link
                  className="panel-link"
                  href={href({ before_sequence: page.next_before_sequence })}
                >
                  Earlier run sequences
                </Link>
              )}
              {'tool_calls' in page && page.next_before_id && (
                <Link className="panel-link" href={href({ before_id: page.next_before_id })}>
                  Next tool records
                </Link>
              )}
            </nav>
          </div>
        </Panel>
      </>
    );
  } catch (error) {
    return (
      <>
        <div className="page-heading">
          <h1>Session activity</h1>
        </div>
        <PageError error={error} />
      </>
    );
  }
}

function RecordInfo({
  id,
  version,
  trace,
  sources,
}: {
  id: string;
  version: number;
  trace: string;
  sources: SourceRef[];
}) {
  return (
    <details>
      <summary>Record details</summary>
      <p>ID · {id}</p>
      <p>Record version · {version}</p>
      <p>Trace · {trace}</p>
      <h4>Recorded source references</h4>
      {sources.length ? (
        <ul>
          {sources.map((source, index) => (
            <li key={index}>
              {source.type} · {source.id}
              {source.revision === undefined ? '' : ` · revision ${source.revision}`}
            </li>
          ))}
        </ul>
      ) : (
        <p>No source references recorded.</p>
      )}
    </details>
  );
}
