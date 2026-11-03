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
            Find an original decision, back up saved reviews or restore missing copies. Loading and
            restoring do not send a review; query its receipt or explicitly send only after
            inspecting the original.
          </p>
        </div>
      </div>
      {content}
      <p>
        <Link href="/proposals/recover-review-draft" prefetch={false}>
          Recover unfinished review drafts
        </Link>
      </p>
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
