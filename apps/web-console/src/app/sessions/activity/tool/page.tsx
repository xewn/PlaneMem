import Link from 'next/link';
import { isUlid } from '@planemem/contracts';
import { PageError } from '../../../../components/page-state';
import { Panel } from '../../../../components/ui';
import { getWorkbenchSessionToolCall } from '../../../../lib/server-api';
import { ToolResultForm } from './form';

export default async function SessionToolPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const params = await searchParams;
    if (
      Object.keys(params).some((key) => !['session', 'tool'].includes(key)) ||
      !isUlid(params.session) ||
      !isUlid(params.tool)
    )
      throw new Error('Select a session and tool call to read its details.');
    const sessionId = params.session;
    const toolCallId = params.tool;
    const result = await getWorkbenchSessionToolCall(sessionId, toolCallId);
    const runId = result.data.run.run_id;
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Tool call details</h1>
            <p>Review this recorded call and record its result.</p>
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
            href={{ pathname: '/sessions/detail', query: { session: sessionId } }}
          >
            Session state and recovery ↗
          </Link>
          <Link
            className="panel-link"
            target="_blank"
            rel="noreferrer"
            href={{ pathname: '/sessions/activity/run', query: { session: sessionId, run: runId } }}
          >
            Parent run ↗
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
        <Panel title="Recorded tool call" icon="sessions">
          <div className="session-activity-list">
            <ToolResultForm
              key={JSON.stringify([result.session_identity, sessionId, toolCallId])}
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
          <h1>Tool call details</h1>
        </div>
        <PageError error={error} />
        <Link className="panel-link" href="/sessions/recover" prefetch={false}>
          Recover an original result request in this tab
        </Link>
      </>
    );
  }
}
