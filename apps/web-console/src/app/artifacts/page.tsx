import Link from 'next/link';
import { isUlid, type ArtifactReadQuery, type SourceRef } from '@planemem/contracts';
import { PageError } from '../../components/page-state';
import { Badge, EmptyState, Panel } from '../../components/ui';
import { getWorkbenchArtifact, WorkbenchApiError } from '../../lib/server-api';
import { ArtifactLookup } from './lookup';
import { ArtifactDownload } from './download';
import { artifactVersionsPageHref } from './versions/query';
import { newArtifactUploadHref } from './upload/preparation-model';
import { artifactPageHref, parseArtifactPageQuery, type ArtifactPageParams } from './query';

export const dynamic = 'force-dynamic';

export default async function ArtifactsPage({
  searchParams,
}: {
  searchParams: Promise<ArtifactPageParams>;
}) {
  const params = await searchParams;
  let query: ArtifactReadQuery | undefined;
  let inputError: unknown;
  try {
    query = parseArtifactPageQuery(params);
  } catch (error) {
    inputError = error;
  }
  const artifactId = isUlid(params.artifact) ? params.artifact : '';
  const version = query?.version === undefined ? '' : String(query.version);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Files &amp; artifacts</h1>
          <p>Look up a saved file and review its current or historical details.</p>
        </div>
        <div className="heading-actions">
          <Link
            className="panel-link"
            href="/artifacts/browse"
            prefetch={false}
            target="_blank"
            rel="noreferrer"
          >
            Browse project files ↗
          </Link>
          <Link
            className="panel-link"
            href="/artifacts/versions"
            prefetch={false}
            target="_blank"
            rel="noreferrer"
          >
            Browse version history ↗
          </Link>
          <Link
            className="panel-link"
            href="/artifacts/upload/new"
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Prepare an upload ↗
          </Link>
          <Link
            className="panel-link"
            href="/artifacts/receipt"
            target="_blank"
            rel="noreferrer"
            prefetch={false}
          >
            Check an original request in a new tab ↗
          </Link>
        </div>
      </div>
      <ArtifactLookup
        key={JSON.stringify([artifactId, version])}
        artifactId={artifactId}
        version={version}
      />
      {inputError ? (
        <PageError error={inputError} />
      ) : query ? (
        <ArtifactRecord query={query} />
      ) : (
        <Panel title="Open a file by ID" icon="database">
          <div className="side-detail">
            <p>
              Enter a file ID above to read its details. Add a version number to open an earlier
              record.
            </p>
            <p className="muted">
              This view shows saved file information and source references. File contents are not
              opened here.
            </p>
          </div>
        </Panel>
      )}
    </>
  );
}

async function ArtifactRecord({ query }: { query: ArtifactReadQuery }) {
  try {
    const result = await getWorkbenchArtifact(query.artifact_id, query.version);
    const { artifact, snapshot } = result.data;
    const historical = snapshot === 'historical';
    const classificationTone = {
      public: 'green',
      internal: 'blue',
      confidential: 'yellow',
      restricted: 'red',
    }[artifact.classification];
    return (
      <>
        <nav className="heading-actions" aria-label="Compare file records">
          <Link
            className="panel-link"
            href={artifactVersionsPageHref({
              artifact_id: artifact.artifact_id,
              at_version: artifact.version,
            })}
            prefetch={false}
            target="_blank"
            rel="noreferrer"
          >
            Browse history through version {artifact.version} ↗
          </Link>
          <Link
            className="panel-link"
            href={newArtifactUploadHref(artifact.artifact_id, artifact.version)}
            prefetch={false}
            target="_blank"
            rel="noreferrer"
          >
            Prepare a new version after {artifact.version} ↗
          </Link>
          {historical ? (
            <Link
              className="panel-link"
              href={artifactPageHref(artifact.artifact_id)}
              prefetch={false}
              target="_blank"
              rel="noreferrer"
            >
              Read current metadata in a new tab ↗
            </Link>
          ) : (
            <Link
              className="panel-link"
              href={artifactPageHref(artifact.artifact_id, artifact.version)}
              prefetch={false}
              target="_blank"
              rel="noreferrer"
            >
              Open saved version {artifact.version} in a new tab ↗
            </Link>
          )}
        </nav>
        <Panel
          title={historical ? `Saved version ${artifact.version}` : 'Current record at page load'}
          icon="database"
        >
          <div className="side-detail artifact-details">
            <h2>{artifact.name}</h2>
            <div className="artifact-badges">
              <Badge tone={classificationTone}>{artifact.classification}</Badge>
              <Badge>{historical ? 'Historical snapshot' : 'Current snapshot'}</Badge>
              <Badge tone="yellow">Metadata lookup only</Badge>
            </div>
            <p>
              {historical
                ? 'These details were saved with the selected version. The current file record may have changed.'
                : 'These are the details returned when this page loaded. Use the form above to read the current record again.'}
            </p>
            <dl className="detail-grid checkpoint-detail-meta">
              <div>
                <dt>File ID</dt>
                <dd>{artifact.artifact_id}</dd>
              </div>
              <div>
                <dt>Project</dt>
                <dd>{artifact.project_id}</dd>
              </div>
              <div>
                <dt>File type</dt>
                <dd>{artifact.mime}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{artifact.size.toLocaleString('en-US')} bytes</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{artifact.version}</dd>
              </div>
              <div>
                <dt>File first recorded</dt>
                <dd>
                  <time dateTime={artifact.created_at}>{artifact.created_at}</time>
                </dd>
              </div>
              <div>
                <dt>Version saved</dt>
                <dd>
                  <time dateTime={artifact.updated_at}>{artifact.updated_at}</time>
                </dd>
              </div>
            </dl>
            <p className="muted">
              This read does not confirm download availability or the outcome of an earlier upload
              request.
            </p>
          </div>
        </Panel>
        <ArtifactDownload
          key={JSON.stringify([
            artifact.tenant_id,
            artifact.workspace_id,
            artifact.project_id,
            artifact.artifact_id,
            artifact.version,
            artifact.sha256,
            artifact.size,
            artifact.classification,
          ])}
          artifact={artifact}
        />
        <Panel title="Recorded sources" icon="context">
          <div className="side-detail artifact-details">
            <p className="muted">
              These references belong to version {artifact.version}. Their current availability has
              not been checked.
            </p>
            <ArtifactSources refs={artifact.source_refs} />
          </div>
        </Panel>
        <Panel title="Record details" icon="audit">
          <div className="side-detail artifact-details">
            <details>
              <summary>Show saved hash, scope and trace information</summary>
              <dl className="detail-grid checkpoint-detail-meta">
                <div>
                  <dt>Saved SHA-256</dt>
                  <dd>
                    <code>{artifact.sha256}</code>
                  </dd>
                </div>
                <div>
                  <dt>Saved version tag</dt>
                  <dd>
                    <code>{artifact.etag}</code>
                  </dd>
                </div>
                <div>
                  <dt>Tenant</dt>
                  <dd>{artifact.tenant_id}</dd>
                </div>
                <div>
                  <dt>Workspace</dt>
                  <dd>{artifact.workspace_id}</dd>
                </div>
                <div>
                  <dt>Record trace</dt>
                  <dd>{artifact.trace_id}</dd>
                </div>
                <div>
                  <dt>Read trace</dt>
                  <dd>{result.trace_id}</dd>
                </div>
              </dl>
              <p className="muted">
                The saved hash describes this version. File contents were not read to verify it
                during this request.
              </p>
            </details>
          </div>
        </Panel>
      </>
    );
  } catch (error) {
    return <ArtifactReadError error={error} />;
  }
}

function ArtifactSources({ refs }: { refs: SourceRef[] }) {
  if (!refs.length) return <p>No sources were recorded for this version.</p>;
  return (
    <ul className="artifact-sources">
      {refs.map((source, index) => (
        <li key={index}>
          <code>
            {source.type}: {source.id}
          </code>
          {source.revision !== undefined && <span> · revision {source.revision}</span>}
          {source.uri !== undefined && <p>{source.uri}</p>}
        </li>
      ))}
    </ul>
  );
}

function ArtifactReadError({ error }: { error: unknown }) {
  if (error instanceof WorkbenchApiError) {
    const message =
      error.code === 'ARTIFACT_LEGACY_UNVERIFIED'
        ? {
            title: 'Saved details unavailable',
            description:
              'A complete saved version record is missing. The requested details cannot be shown.',
          }
        : error.status === 404
          ? {
              title: 'File or version unavailable',
              description: 'The requested record could not be found in the project you can access.',
            }
          : error.status === 503
            ? {
                title: 'File records unavailable',
                description:
                  'The file service is unavailable. You can try reading the same file and version again later.',
              }
            : undefined;
    if (message)
      return (
        <div className="panel">
          <EmptyState
            title={message.title}
            message={message.description}
            {...(typeof error.trace_id === 'string' ? { trace: error.trace_id } : {})}
          />
        </div>
      );
  }
  return <PageError error={error} />;
}
