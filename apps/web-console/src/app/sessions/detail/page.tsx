import Link from 'next/link';
import { isUlid } from '@planemem/contracts';
import { PageError, toneFor } from '../../../components/page-state';
import { Badge, Panel } from '../../../components/ui';
import { getWorkbenchSessionState } from '../../../lib/server-api';
import { CheckpointForm } from '../checkpoint-form';
import { EndSessionForm } from '../end-form';
import { SessionLookup } from '../lookup';

export default async function SessionStatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Session state and recovery</h1>
          <p>Read one session and continue its checkpoint or closure workflow.</p>
        </div>
      </div>
      <SessionState searchParams={searchParams} />
      <SessionLookup />
    </>
  );
}

async function SessionState({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const params = await searchParams;
    if (Object.keys(params).some((key) => key !== 'session') || !isUlid(params.session))
      throw new Error('Supply one session ID to read its current state.');
    const result = await getWorkbenchSessionState(params.session);
    const session = result.data;
    const identity = result.session_identity;
    const canWrite = result.session_permissions?.write_sessions === true;
    const refreshHref = '/sessions/detail?session=' + encodeURIComponent(session.session_id);
    return (
      <>
        <nav className="heading-actions" aria-label="Related session views in new tabs">
          <Link
            className="panel-link"
            href={{ pathname: '/sessions', query: { item: session.session_id } }}
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Registry and lineage ↗
          </Link>
          <Link
            className="panel-link"
            href={{ pathname: '/sessions/activity', query: { session: session.session_id } }}
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Runs and tool calls ↗
          </Link>
          <Link
            className="panel-link"
            href={{
              pathname: '/sessions/activity/create',
              query: { session: session.session_id, operation: 'run.start' },
            }}
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Start or recover a run ↗
          </Link>
          <Link
            className="panel-link"
            href={{ pathname: '/sessions/history', query: { session: session.session_id } }}
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Checkpoint history ↗
          </Link>
          <Link
            className="panel-link"
            href={{ pathname: '/audit', query: { session_id: session.session_id } }}
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Audit records for this session ↗
          </Link>
          <Link
            className="panel-link"
            href={refreshHref}
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Read current state in a new tab ↗
          </Link>
        </nav>
        <Panel title="Session state at page load" icon="sessions">
          <div className="side-detail">
            <Badge tone={toneFor(session.status)}>{session.status}</Badge>
            <dl className="detail-grid checkpoint-detail-meta">
              <div>
                <dt>Session</dt>
                <dd>{session.session_id}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{session.version}</dd>
              </div>
              <div>
                <dt>Closed</dt>
                <dd>{session.ended_at ?? 'Not closed'}</dd>
              </div>
              <div>
                <dt>Read trace</dt>
                <dd>{result.trace_id}</dd>
              </div>
            </dl>
            <p className="muted">
              This snapshot reflects the page load. Each form can read current state without
              changing its saved request. Current state does not confirm the outcome of an earlier
              command.
            </p>
          </div>
        </Panel>
        <div key={JSON.stringify([identity, session.session_id])}>
          <Panel title="Checkpoint and closure requests" icon="sessions">
            <div className="side-detail">
              {!identity && (
                <p>
                  A verified client identity is required to use request recovery. The session
                  remains available to read.
                </p>
              )}
              {identity && (
                <p>
                  Original requests saved in this tab take priority. To continue in another tab,
                  export the original request and import it under the same account, client and
                  project.
                </p>
              )}
              <CheckpointForm
                initial={session}
                identity={identity}
                canWrite={canWrite}
                initialKey={crypto.randomUUID()}
              />
              <EndSessionForm
                initial={session}
                identity={identity}
                canWrite={canWrite}
                initialKey={crypto.randomUUID()}
                refreshHref={refreshHref}
              />
            </div>
          </Panel>
        </div>
      </>
    );
  } catch (error) {
    return <PageError error={error} />;
  }
}
