import Link from 'next/link';
import {
  ContextPackSaveError,
  getWorkbenchContextPackSaveBinding,
} from '../../../../lib/context-pack-compile-server';
import { PackSaveRecovery } from './loader';

export default async function PackSaveRecoveryPage() {
  let content;
  try {
    const authority = await getWorkbenchContextPackSaveBinding();
    content = (
      <PackSaveRecovery key={JSON.stringify(authority.binding)} binding={authority.binding} />
    );
  } catch (error) {
    content = (
      <>
        <p role="status">
          {error instanceof ContextPackSaveError
            ? error.message
            : 'Save identity could not be read.'}
        </p>
        <p>
          Restore the original gateway, project, account, client and permissions, then reload. No
          original request was changed or sent.
        </p>
        <p>
          <Link href="/login" prefetch={false}>
            Sign in
          </Link>{' '}
          ·{' '}
          <Link href="/context/packs/recover" prefetch={false}>
            Reload recovery
          </Link>
        </p>
      </>
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Recover an original context pack save</h1>
          <p>
            Load the complete original request from this browser or a file. Loading never sends it.
          </p>
        </div>
      </div>
      {content}
      <p>
        <Link href="/context" prefetch={false}>
          Context and new save requests
        </Link>{' '}
        ·{' '}
        <Link href="/context/packs" prefetch={false}>
          Saved pack directory
        </Link>
      </p>
    </>
  );
}
