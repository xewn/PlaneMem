import Link from 'next/link';
import { ArtifactUploadForm } from './form';

export const dynamic = 'force-dynamic';

export default function ArtifactUploadPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Upload a file</h1>
          <p>Create a file or add a version using a saved original request.</p>
        </div>
        <div className="heading-actions">
          <Link
            className="panel-link"
            href="/artifacts/upload/new"
            prefetch={false}
            target="_blank"
            rel="noreferrer"
          >
            Prepare a new upload in a new tab ↗
          </Link>
          <Link
            className="panel-link"
            href="/artifacts"
            prefetch={false}
            target="_blank"
            rel="noreferrer"
          >
            Open file lookup in a new tab ↗
          </Link>
        </div>
      </div>
      <ArtifactUploadForm />
    </>
  );
}
