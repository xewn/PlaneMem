import Link from 'next/link';
import { parseCheckpointHistoryQuery } from '@planemem/contracts';
import { PageError } from '../../../components/page-state';
import { Panel } from '../../../components/ui';
import { CheckpointHistory } from '../history';
import { SessionLookup } from '../lookup';
import { CheckpointLookup } from '../checkpoint-lookup';

export default async function CheckpointHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Checkpoint history</h1>
          <p>Browse saved revisions for one session.</p>
        </div>
      </div>
      <History searchParams={searchParams} />
      <SessionLookup />
    </>
  );
}

async function History({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const params = await searchParams;
    if (
      Object.keys(params).some((key) => !['session', 'before'].includes(key)) ||
      (params.before !== undefined &&
        (typeof params.before !== 'string' || !/^[1-9][0-9]*$/.test(params.before)))
    )
      throw new Error('Choose a session and an optional positive revision cursor.');
    const query = parseCheckpointHistoryQuery({
      session_id: params.session,
      ...(params.before === undefined ? {} : { before_revision: Number(params.before) }),
    });
    return (
      <>
        <nav className="heading-actions" aria-label="Related session views in new tabs">
          <Link
            className="panel-link"
            target="_blank"
            rel="noreferrer"
            prefetch={false}
            href={{ pathname: '/sessions/detail', query: { session: query.session_id } }}
          >
            Session state and recovery ↗
          </Link>
          <Link
            className="panel-link"
            target="_blank"
            rel="noreferrer"
            prefetch={false}
            href={{ pathname: '/sessions/activity', query: { session: query.session_id } }}
          >
            Runs and tool calls ↗
          </Link>
        </nav>
        <Panel title={`Session ${query.session_id}`} icon="sessions">
          <div className="side-detail">
            <p className="muted">
              Revisions are shown newest first, up to ten per page. New saves may appear when you
              return to the latest revisions.
            </p>
            <CheckpointHistory
              session={query.session_id}
              before={query.before_revision}
              standalone
            />
          </div>
        </Panel>
      </>
    );
  } catch (error) {
    return (
      <>
        <PageError error={error} />
        <CheckpointLookup />
      </>
    );
  }
}
