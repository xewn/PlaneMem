import Link from 'next/link';
import { PageError } from '../../../components/page-state';
import { getWorkbenchProposalSubmissionBinding } from '../../../lib/server-api';
import { CreationHistoryPanel } from '../creation-history-panel';

export default async function CreationHistoryPage() {
  let content;
  try {
    const binding = await getWorkbenchProposalSubmissionBinding();
    content = <CreationHistoryPanel key={JSON.stringify(binding)} binding={binding} />;
  } catch (error) {
    content = (
      <>
        <PageError error={error} />
        <p>
          Restore the original gateway, project, account and client, then reload to inspect your
          history file. No saved file or request has been changed.
        </p>
        <Link href="/proposals/creation-history" prefetch={false}>
          Reload creation history
        </Link>
      </>
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Inspect creation history files</h1>
          <p>
            Read an exported original request and its complete historical response. Imported history
            does not confirm a new submission or the proposal’s current state.
          </p>
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
