import Link from 'next/link';
import { PageError } from '../../../components/page-state';
import { getWorkbenchProposalSubmissionBinding } from '../../../lib/server-api';
import { ReviewEditingPanel } from '../review-editing-panel';

export default async function ReviewDraftRecoveryPage() {
  let content;
  try {
    const binding = await getWorkbenchProposalSubmissionBinding();
    content = <ReviewEditingPanel key={JSON.stringify(binding)} binding={binding} />;
  } catch (error) {
    content = (
      <>
        <PageError error={error} />
        <p>
          Restore the original gateway, project, account and client, then reload draft recovery.
          Saved copies have not been changed or sent.
        </p>
        <Link href="/proposals/recover-review-draft" prefetch={false}>
          Reload review draft recovery
        </Link>
      </>
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Recover unfinished proposal reviews</h1>
          <p>
            Find manual or automatic editing copies, back up either collection or restore missing
            copies. Inspect the complete reason before resuming from the same proposal revision in
            its review form. You can also inspect and remove saved copies, including selected groups
            of manual or automatic copies. Backup restoration and removal do not replace your
            current fields or send a review.
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
        <Link href="/proposals/recover-review" prefetch={false}>
          Recover a prepared original review
        </Link>
      </p>
    </>
  );
}
