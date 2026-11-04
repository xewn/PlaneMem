import Link from 'next/link';
import { SavedArtifactReceiptForm } from './form';

export const dynamic = 'force-dynamic';

export default function SavedArtifactReceiptPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Review a saved file receipt</h1>
          <p>Inspect a receipt file and compare it with your original request on this device.</p>
        </div>
        <div className="heading-actions">
          <Link
            className="panel-link"
            href="/artifacts/receipt"
            prefetch={false}
            target="_blank"
            rel="noreferrer"
          >
            Open server receipt lookup in a new tab ↗
          </Link>
        </div>
      </div>
      <SavedArtifactReceiptForm />
    </>
  );
}
