import Link from 'next/link';
import { isUlid, parseHandoffReadEnvelope } from '@planemem/contracts';
import { PageError } from '../../../components/page-state';
import { getWorkbenchHandoff } from '../../../lib/server-api';
import { LiveHandoffDetail } from '../live-detail';

export default async function HandoffDetailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const params = await searchParams;
    if (Object.keys(params).some((key) => key !== 'handoff') || !isUlid(params.handoff))
      throw new Error('Select a handoff to read its current details.');
    const result = await getWorkbenchHandoff(params.handoff);
    const snapshot = parseHandoffReadEnvelope(result, params.handoff, result.data, result.trace_id);
    const handoff = snapshot.data;
    const identity = snapshot.session_identity;
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Handoff details</h1>
            <p>Current ownership and saved references for this handoff.</p>
          </div>
        </div>
        <nav className="heading-actions" aria-label="Related records and recovery">
          <Link className="panel-link" href="/handoffs/recover" prefetch={false}>
            Recover an original request in this tab
          </Link>
          <Link className="panel-link" href="/handoffs" target="_blank" rel="noreferrer">
            Handoff queue ↗
          </Link>
          <Link
            className="panel-link"
            href={{ pathname: '/sessions/detail', query: { session: handoff.session_id } }}
            target="_blank"
            rel="noreferrer"
          >
            Original session state ↗
          </Link>
          <Link
            className="panel-link"
            href={{ pathname: '/handoffs/detail', query: { handoff: handoff.handoff_id } }}
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Read current state in a new tab ↗
          </Link>
        </nav>
        <LiveHandoffDetail
          key={JSON.stringify([
            identity,
            handoff.session_id,
            handoff.handoff_id,
            handoff.checkpoint_id,
          ])}
          initial={snapshot}
        />
      </>
    );
  } catch (error) {
    return (
      <>
        <div className="page-heading">
          <h1>Handoff details</h1>
        </div>
        <PageError error={error} />
        <Link className="panel-link" href="/handoffs/recover" prefetch={false}>
          Recover an original request in this tab
        </Link>
      </>
    );
  }
}
