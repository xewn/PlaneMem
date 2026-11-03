import Link from 'next/link';
import { PageError } from '../../../components/page-state';
import { getWorkbenchProposalSubmissionBinding } from '../../../lib/server-api';
import { ProposalRecoveryLoader } from './loader';

export default async function ProposalRecoveryPage() {
  let content;
  try {
    const binding = await getWorkbenchProposalSubmissionBinding();
    content = <ProposalRecoveryLoader key={JSON.stringify(binding)} binding={binding} />;
  } catch (error) {
    content = (
      <>
        <PageError error={error} />
        <p>
          Restore the original account, client, gateway and project, then reload recovery. Saved
          requests have not been changed or sent.
        </p>
        <Link href="/proposals/recover" prefetch={false}>
          Reload recovery
        </Link>
      </>
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Recover an original proposal submission</h1>
          <p>Read your current identity, then load the original request for an explicit retry.</p>
        </div>
      </div>
      {content}
      <p>
        <Link href="/proposals" prefetch={false}>
          Proposal directory
        </Link>
      </p>
    </>
  );
}
