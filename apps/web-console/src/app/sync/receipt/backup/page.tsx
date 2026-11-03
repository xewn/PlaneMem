import Link from 'next/link';
import { OriginalBackupForm } from './form';

export const dynamic = 'force-dynamic';
export default function OriginalBackupPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Back up saved sync originals</h1>
          <p>
            Keep a complete copy of the original queries saved in this browser, or restore a backup.
          </p>
        </div>
      </div>
      <OriginalBackupForm />
      <Link href="/sync/receipt" target="_blank" rel="noreferrer" prefetch={false}>
        Browse originals and check delivery in another tab ↗
      </Link>
    </>
  );
}
