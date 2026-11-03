import Link from 'next/link';
import { isUlid } from '@planemem/contracts';
import { PageError } from '../../../../components/page-state';
import { Panel } from '../../../../components/ui';
import { getWorkbenchSessionRun } from '../../../../lib/server-api';
import { RunResultForm } from './form';

export default async function SessionRunPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const params = await searchParams;
    if (
      Object.keys(params).some((key) => !['session', 'run'].includes(key)) ||
      !isUlid(params.session) ||
      !isUlid(params.run)
    )
      throw new Error('Select a session and run to read its details.');
    const sessionId = params.session;
    const runId = params.run;
    const result = await getWorkbenchSessionRun(sessionId, runId);
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Run details</h1>
            <p>Review this recorded run and record its result.</p>
          </div>
        </div>
        <nav className="heading-actions" aria-label="Related records and recovery">
          <Link className="panel-link" href="/sessions/recover" prefetch={false}>
            Recover an original result request in this tab
          </Link>
          <Link
            className="panel-link"
            target="_blank"
            rel="noreferrer"
            href={{
              pathname: '/sessions/activity/create',
              query: { session: sessionId, operation: 'tool.call', run: runId },
            }}
          >
            Record a tool call ↗
          </Link>
          <Link
            className="panel-link"
            target="_blank"
            rel="noreferrer"
            href={{ pathname: '/sessions/detail', query: { session: sessionId } }}
          >
            Session state and recovery ↗
          </Link>
          <Link
            className="panel-link"
            target="_blank"
            rel="noreferrer"
            href={{ pathname: '/sessions/activity', query: { session: sessionId, view: 'runs' } }}
          >
            All runs ↗
          </Link>
          <Link
            className="panel-link"
            target="_blank"
            rel="noreferrer"
            href={{
              pathname: '/sessions/activity',
              query: { session: sessionId, view: 'tools', run_id: runId },
            }}
          >
            This run’s tool calls ↗
          </Link>
        </nav>
        <Panel title="Recorded run" icon="sessions">
          <div className="session-activity-list">
            <RunResultForm
              key={JSON.stringify([result.session_identity, sessionId, runId])}
              initial={result.data}
              identity={result.session_identity}
              initialCanWrite={result.session_permissions?.write_sessions === true}
              initialKey={crypto.randomUUID()}
            />
          </div>
        </Panel>
      </>
    );
  } catch (error) {
    return (
      <>
        <div className="page-heading">
          <h1>Run details</h1>
        </div>
        <PageError error={error} />
        <Link className="panel-link" href="/sessions/recover" prefetch={false}>
          Recover an original result request in this tab
        </Link>
      </>
    );
  }
}
