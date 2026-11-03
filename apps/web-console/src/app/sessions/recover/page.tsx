import Link from 'next/link';
import { PageError } from '../../../components/page-state';
import { Panel } from '../../../components/ui';
import { getWorkbenchSessionCommandContext } from '../../../lib/server-api';
import { SessionRecoveryLoader } from './loader';

export default async function RecoverSessionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Recover a session request</h1>
          <p>
            Recover an original session start, checkpoint, session closure, run or tool call
            request.
          </p>
        </div>
      </div>
      <nav className="heading-actions" aria-label="Related pages">
        <Link className="panel-link" href="/sessions" prefetch={false}>
          Session registry
        </Link>
        <Link className="panel-link" href="/handoffs/recover" prefetch={false}>
          Recover a handoff request in this tab
        </Link>
      </nav>
      <p className="muted">
        This page reads your verified identity without loading current session or activity records.
        Opening it does not query a receipt or send a command. Use the original account, client and
        project.
      </p>
      <Recovery searchParams={searchParams} />
    </>
  );
}

async function Recovery({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    if (Object.keys(await searchParams).length)
      throw new Error('Recovery takes no URL parameters. Load the saved original request below.');
    const response = await getWorkbenchSessionCommandContext();
    const { identity, permissions, expires_at } = response.data;
    return (
      <Panel title="Original session request" icon="sessions">
        <div className="side-detail" style={{ overflowWrap: 'anywhere' }}>
          <p>
            Account · {identity.actor_id} · Client · {identity.client_id}
          </p>
          <p>Project · {identity.project_id}</p>
          <p>
            Tenant · {identity.tenant_id} · Workspace · {identity.workspace_id}
          </p>
          <p className="muted">
            Session expires at <time dateTime={expires_at}>{expires_at}</time>. Each operation
            checks access again.
          </p>
        </div>
        <SessionRecoveryLoader
          key={JSON.stringify(identity)}
          identity={identity}
          canWrite={permissions.write_sessions}
        />
      </Panel>
    );
  } catch (error) {
    return (
      <>
        <PageError error={error} />
        <p>
          Your saved requests have not been removed or submitted. Renew the original session, then
          reopen this page.
        </p>
        <Link className="panel-link" href="/sessions/recover" prefetch={false}>
          Reload recovery identity
        </Link>
      </>
    );
  }
}
