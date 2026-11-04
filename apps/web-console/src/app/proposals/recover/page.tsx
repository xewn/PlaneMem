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
          <p>
            Load the complete original request to check its result or explicitly retry. You can also
            inspect, export and remove selected saved browser copies together. Removing copies does
            not cancel a proposal and keeps old tab copies.
          </p>
        </div>
      </div>
      {content}
      <p>
        <Link href="/proposals/creation-history" prefetch={false}>
          Inspect a creation history file or extract its original request
        </Link>
      </p>
      <p>
        <Link href="/proposals/recover-review" prefetch={false}>
          Recover an original review decision
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
