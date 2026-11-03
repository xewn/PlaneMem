import Link from 'next/link';
import { PageError } from '../../../components/page-state';
import { Panel } from '../../../components/ui';
import { getWorkbenchSessionCommandContext } from '../../../lib/server-api';
import { CreateForm } from '../create-form';
import { OriginalHandoffRecovery } from './original-request';

export default async function RecoverHandoffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Recover a handoff request</h1>
          <p>
            Restore the original request and check its receipt using the original account and
            client.
          </p>
        </div>
      </div>
      <nav className="heading-actions" aria-label="Related pages">
        <Link className="panel-link" href="/sessions/recover" prefetch={false}>
          Recover a session, checkpoint or activity request in this tab
        </Link>
        <Link className="panel-link" href="/handoffs" prefetch={false}>
          Handoff queue
        </Link>
        <Link className="panel-link" href="/handoffs?create=1" prefetch={false}>
          Prepare a new handoff
        </Link>
      </nav>
      <p className="muted">
        This page reads your verified identity independently of the handoff queue, session records
        and checkpoint list. Opening it does not send a creation, claim, resume or receipt request.
        Keep an exported copy before closing this tab.
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
      throw new Error('Recovery takes no URL parameters. Import the saved original request below.');
    const response = await getWorkbenchSessionCommandContext();
    const { identity, permissions, expires_at } = response.data;
    return (
      <>
        <div className="side-detail">
          <p style={{ overflowWrap: 'anywhere' }}>
            Account · {identity.actor_id} · Client · {identity.client_id}
          </p>
          <p style={{ overflowWrap: 'anywhere' }}>Project · {identity.project_id}</p>
          <p style={{ overflowWrap: 'anywhere' }}>
            Tenant · {identity.tenant_id} · Workspace · {identity.workspace_id}
          </p>
          <p className="muted">
            Session expires at <time dateTime={expires_at}>{expires_at}</time>. Each operation
            checks access again.
          </p>
        </div>
        <Panel title="Original creation request" icon="handoffs">
          <CreateForm
            key={JSON.stringify(identity)}
            options={[]}
            initialKey=""
            identity={identity}
            canWrite={permissions.write_sessions}
            recoveryOnly
          />
        </Panel>
        <Panel title="Original ownership claim" icon="handoffs">
          <OriginalHandoffRecovery
            key={JSON.stringify(['claim', identity])}
            operation="claim"
            identity={identity}
            canWrite={permissions.claim_handoffs}
          />
        </Panel>
        <Panel title="Original session resume" icon="handoffs">
          <OriginalHandoffRecovery
            key={JSON.stringify(['resume', identity])}
            operation="resume"
            identity={identity}
            canWrite={permissions.write_sessions}
          />
        </Panel>
      </>
    );
  } catch (error) {
    return (
      <>
        <PageError error={error} />
        <p className="muted">
          Your saved request has not been removed or submitted. Renew the original session, then
          reopen this page.
        </p>
        <Link className="panel-link" href="/handoffs/recover" prefetch={false}>
          Reload recovery identity
        </Link>
      </>
    );
  }
}
