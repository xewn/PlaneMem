import Link from 'next/link';
import { ReceiptBackupForm } from './form';

export const dynamic = 'force-dynamic';
export default function ReceiptBackupPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Back up historical sync receipts</h1>
          <p>Keep a complete copy of saved historical receipts, or review and restore a backup.</p>
        </div>
      </div>
      <ReceiptBackupForm />
      <Link href="/sync/receipt" target="_blank" rel="noreferrer" prefetch={false}>
        Browse saved receipts in another tab ↗
      </Link>
    </>
  );
}
