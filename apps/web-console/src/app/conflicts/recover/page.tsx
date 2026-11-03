import Link from 'next/link';
import { PageError } from '../../../components/page-state';
import { Panel } from '../../../components/ui';
import { getWorkbenchConflictCommandContext } from '../../../lib/server-api';
import { ConflictRecoveryLoader } from './loader';

export default async function ConflictRecoveryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Recover an original conflict decision</h1>
          <p>Load the complete original request to check its receipt or explicitly resend it.</p>
        </div>
      </div>
      <p>
        Opening this page reads only your verified conflict operation identity. It does not read the
        conflict directory or details, query a receipt, or send a decision.
      </p>
      <Recovery searchParams={searchParams} />
      <Link href="/conflicts" prefetch={false}>
        Conflict directory
      </Link>
      <Link href="/conflicts/receipt" target="_blank" rel="noreferrer" prefetch={false}>
        Read-only original receipt lookup ↗
      </Link>
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
      throw new Error('Recovery takes no URL parameters. Load the original request below.');
    const response = await getWorkbenchConflictCommandContext();
    const { identity, expires_at } = response.data;
    return (
      <Panel title="Original conflict request" icon="conflicts">
        <div className="side-detail" style={{ overflowWrap: 'anywhere' }}>
          <p>
            Account · {identity.actor_id} · Client · {identity.client_id}
          </p>
          <p>
            Tenant · {identity.tenant_id} · Workspace · {identity.workspace_id} · Project ·{' '}
            {identity.project_id}
          </p>
          <p>
            Identity expires at <time dateTime={expires_at}>{expires_at}</time>. Every operation
            checks current access again.
          </p>
          <ConflictRecoveryLoader key={JSON.stringify(identity)} identity={identity} />
        </div>
      </Panel>
    );
  } catch (error) {
    return (
      <>
        <PageError error={error} />
        <p>
          Saved requests have not been removed or sent. Restore the original account, client and
          project with conflict resolution access, then reload this page.
        </p>
        <Link href="/conflicts/recover" prefetch={false}>
          Reload recovery identity
        </Link>
        <Link href="/login" target="_blank" rel="noreferrer" prefetch={false}>
          Renew sign-in ↗
        </Link>
      </>
    );
  }
}
