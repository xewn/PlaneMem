import Link from 'next/link';
import { isUlid } from '@planemem/contracts';
import { PageError } from '../../../../components/page-state';
import { Panel } from '../../../../components/ui';
import { getWorkbenchArtifactPreparation } from '../../../../lib/artifact-preparation-server';
import { ArtifactUploadForm } from '../form';
import { newArtifactUploadHref } from '../preparation-model';

export const dynamic = 'force-dynamic';

export default async function NewArtifactUploadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  let preparation;
  let failure: unknown;
  try {
    if (
      Object.keys(params).some((key) => key !== 'artifact') ||
      (params.artifact !== undefined && !isUlid(params.artifact))
    )
      throw new Error('Use one complete file ID to prepare its next version.');
    preparation = await getWorkbenchArtifactPreparation(params.artifact as string | undefined);
  } catch (error) {
    failure = error;
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Prepare a new upload</h1>
          <p>Review a new request locally, save its JSON, then submit it explicitly.</p>
        </div>
        <Link
          className="panel-link"
          href="/artifacts/upload"
          prefetch={false}
          target="_blank"
          rel="noreferrer"
        >
          Recover or upload a saved request ↗
        </Link>
      </div>
      <Panel title="Choose what to prepare" icon="database">
        <div className="side-detail artifact-details">
          <p>
            Use this page for a new upload. To recover a previous attempt, import its saved request
            instead.
          </p>
          <Link
            className="panel-link"
            href={newArtifactUploadHref()}
            prefetch={false}
            target="_blank"
            rel="noreferrer"
          >
            Prepare a new file in a new tab ↗
          </Link>
          <form
            className="handoff-form checkpoint-form"
            action="/artifacts/upload/new"
            method="get"
            target="_blank"
          >
            <label htmlFor="artifact-prepare-target">
              Or prepare a new version of an existing file
            </label>
            <input
              id="artifact-prepare-target"
              name="artifact"
              type="text"
              required
              maxLength={26}
              pattern="[0-9A-HJKMNP-TV-Z]{26}"
              defaultValue={isUlid(params.artifact) ? params.artifact : ''}
              placeholder="File ID"
            />
            <button type="submit" className="secondary-button">
              Read current record in a new preparation tab ↗
            </button>
          </form>
        </div>
      </Panel>
      {failure ? (
        <PageError error={failure} />
      ) : preparation ? (
        <ArtifactUploadForm key={preparation.context.trace_id} preparation={preparation} />
      ) : null}
    </>
  );
}
