import Link from 'next/link';
import { PageError } from '../../../components/page-state';
import { getWorkbenchProposalSubmissionBinding } from '../../../lib/server-api';
import { ReviewHistoryPanel } from '../review-history-panel';

export default async function ReviewHistoryPage() {
  let content;
  try {
    const binding = await getWorkbenchProposalSubmissionBinding();
    content = <ReviewHistoryPanel key={JSON.stringify(binding)} binding={binding} />;
  } catch (error) {
    content = (
      <>
        <PageError error={error} />
        <p>
          Restore the original gateway, project, account and client to read saved history. No saved
          copies have been changed.
        </p>
        <Link href="/proposals/review-history" prefetch={false}>
          Reload review history
        </Link>
      </>
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Saved review history</h1>
          <p>
            Find or import complete historical receipts with their original requests. Loading a
            history copy does not contact the review endpoint or send a decision.
          </p>
        </div>
      </div>
      {content}
      <p>
        <Link href="/proposals/recover-review" prefetch={false}>
          Recover an original review
        </Link>
      </p>
      <p>
        <Link href="/proposals" prefetch={false}>
          Proposal directory
        </Link>
      </p>
    </>
  );
}
