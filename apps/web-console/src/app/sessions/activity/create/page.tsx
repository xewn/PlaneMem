import Link from 'next/link';
import { isUlid } from '@planemem/contracts';
import { PageError } from '../../../../components/page-state';
import { Panel } from '../../../../components/ui';
import { getWorkbenchSessionState, getWorkbenchSessionRun } from '../../../../lib/server-api';
import { ActivityCreateForm } from './form';

export default async function CreateActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const params = await searchParams;
    if (
      Object.keys(params).some((key) => !['session', 'operation', 'run'].includes(key)) ||
      !isUlid(params.session) ||
      (params.operation !== 'run.start' && params.operation !== 'tool.call') ||
      (params.operation === 'tool.call' ? !isUlid(params.run) : params.run !== undefined)
    )
      throw new Error(
        'Choose a session to start a run, or a session and run to record a tool call.',
      );
    const sessionId = params.session;
    const runId = params.operation === 'tool.call' ? (params.run as string) : undefined;
    const result =
      runId === undefined
        ? await getWorkbenchSessionState(sessionId)
        : await getWorkbenchSessionRun(sessionId, runId);
    const initial = 'session' in result.data ? result.data : { session: result.data };
    const title = params.operation === 'run.start' ? 'Start a run' : 'Record a tool call';
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>{title}</h1>
            <p>Record session activity and retain the original request for recovery.</p>
          </div>
        </div>
        <nav className="heading-actions" aria-label="Related records and recovery">
          <Link className="panel-link" href="/sessions/recover" prefetch={false}>
            Recover an original activity request in this tab
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
            Session activity ↗
          </Link>
          {runId && (
            <Link
              className="panel-link"
              target="_blank"
              rel="noreferrer"
              href={{
                pathname: '/sessions/activity/run',
                query: { session: sessionId, run: runId },
              }}
            >
              Run details ↗
            </Link>
          )}
        </nav>
        <Panel title={title} icon="sessions">
          <ActivityCreateForm
            key={JSON.stringify([result.session_identity, sessionId, params.operation, runId])}
            operation={params.operation}
            sessionId={sessionId}
            runId={runId}
            initial={initial}
            identity={result.session_identity}
            initialCanWrite={result.session_permissions?.write_sessions === true}
            initialKey={crypto.randomUUID()}
          />
        </Panel>
      </>
    );
  } catch (error) {
    return (
      <>
        <div className="page-heading">
          <h1>Create session activity</h1>
        </div>
        <PageError error={error} />
        <Link className="panel-link" href="/sessions/recover" prefetch={false}>
          Recover an original activity request in this tab
        </Link>
      </>
    );
  }
}
