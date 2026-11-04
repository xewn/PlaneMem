import Link from 'next/link';
import { ArtifactReceiptForm } from './form';

export const dynamic = 'force-dynamic';

export default function ArtifactReceiptPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Check an original file request</h1>
          <p>Read the saved receipt for a file creation or a new version.</p>
        </div>
        <div className="heading-actions">
          <Link
            className="panel-link"
            href="/artifacts/receipt/saved"
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Review a saved receipt file ↗
          </Link>
          <Link
            className="panel-link"
            href="/artifacts/upload"
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Open upload in a new tab ↗
          </Link>
          <Link
            className="panel-link"
            href="/artifacts"
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Open file lookup in a new tab ↗
          </Link>
        </div>
      </div>
      <ArtifactReceiptForm />
    </>
  );
}
