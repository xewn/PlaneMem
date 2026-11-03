import Link from 'next/link';
import { PageError } from '../../../components/page-state';
import { getWorkbenchProposalSubmissionBinding } from '../../../lib/server-api';
import { ProposalReviewRecovery } from './loader';

export default async function ProposalReviewRecoveryPage() {
  let content;
  try {
    const binding = await getWorkbenchProposalSubmissionBinding();
    content = <ProposalReviewRecovery key={JSON.stringify(binding)} binding={binding} />;
  } catch (error) {
    content = (
      <>
        <PageError error={error} />
        <p>
          Restore the original gateway, project, account and client, then reload review recovery.
          Saved copies have not been changed or sent.
        </p>
        <Link href="/proposals/recover-review" prefetch={false}>
          Reload review recovery
        </Link>
      </>
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Recover an original proposal review</h1>
          <p>
            Load the saved decision and reason, then explicitly decide whether to send the same
            request.
          </p>
        </div>
      </div>
      {content}
      <p>
        <Link href="/proposals" prefetch={false}>
          Proposal directory
        </Link>
      </p>
      <p>
        <Link href="/proposals/recover" prefetch={false}>
          Recover an original proposal submission
        </Link>
      </p>
    </>
  );
}
