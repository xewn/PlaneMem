import Link from 'next/link';
import {
  ContextPackSaveError,
  getWorkbenchContextPackSaveBinding,
} from '../../../../lib/context-pack-compile-server';
import { PackReceiptHistoryBrowser } from './loader';

export default async function PackReceiptHistoryPage() {
  let content;
  try {
    const { binding } = await getWorkbenchContextPackSaveBinding();
    content = <PackReceiptHistoryBrowser key={JSON.stringify(binding)} binding={binding} />;
  } catch (error) {
    content = (
      <>
        <p role="status">
          {error instanceof ContextPackSaveError
            ? error.message
            : 'The original identity could not be confirmed.'}
        </p>
        <p>
          Restore the original gateway, project, account, client and permissions to browse this
          history. No historical receipt was queried or pack save sent.
        </p>
        <p>
          <Link href="/login" prefetch={false}>
            Sign in
          </Link>{' '}
          ·{' '}
          <Link href="/context/packs/receipts" prefetch={false}>
            Reload history
          </Link>
        </p>
      </>
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Historical context pack save observations</h1>
          <p>
            Find browser copies by request key, result and observation dates, or import a CLI or
            browser receipt file. These copies retain past observations and do not establish current
            server state.
          </p>
        </div>
      </div>
      {content}
      <p>
        <Link href="/context/packs/recover" prefetch={false}>
          Recover original requests
        </Link>{' '}
        ·{' '}
        <Link href="/context" prefetch={false}>
          Context and new requests
        </Link>
      </p>
    </>
  );
}
