import Link from 'next/link';
import { isUlid, type ArtifactVersionsQuery } from '@planemem/contracts';
import { PageError } from '../../../components/page-state';
import { Badge, EmptyState, Panel } from '../../../components/ui';
import { getWorkbenchArtifactVersions, WorkbenchApiError } from '../../../lib/server-api';
import { artifactPageHref, type ArtifactPageParams } from '../query';
import { artifactVersionsPageHref, parseArtifactVersionsPageQuery } from './query';

export const dynamic = 'force-dynamic';

export default async function ArtifactVersionsPage({
  searchParams,
}: {
  searchParams: Promise<ArtifactPageParams>;
}) {
  const params = await searchParams;
  let query: ArtifactVersionsQuery | undefined;
  let inputError: unknown;
  try {
    query = parseArtifactVersionsPageQuery(params);
  } catch (error) {
    inputError = error;
  }
  const artifactId = isUlid(params.artifact) ? params.artifact : '';
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>File version history</h1>
          <p>Browse saved versions and open their details.</p>
        </div>
        <nav className="heading-actions" aria-label="Other file views">
          <Link className="panel-link" href="/artifacts" prefetch={false}>
            File lookup
          </Link>
          <Link
            className="panel-link"
            href="/artifacts/browse"
            prefetch={false}
            target="_blank"
            rel="noreferrer"
          >
            Browse project files ↗
          </Link>
        </nav>
      </div>
      <Panel title="Find file history" icon="search">
        <div className="side-detail">
          <form
            key={JSON.stringify([artifactId, query?.limit])}
            className="artifact-lookup-form"
            method="get"
            action="/artifacts/versions"
          >
            <label htmlFor="artifact-history-id">File ID</label>
            <input
              id="artifact-history-id"
              name="artifact"
              defaultValue={artifactId}
              required
              minLength={26}
              maxLength={26}
              pattern="[0-9A-HJKMNP-TV-Z]{26}"
              spellCheck={false}
              autoCapitalize="characters"
            />
            <label htmlFor="artifact-history-limit">Versions per page</label>
            <input
              id="artifact-history-limit"
              name="limit"
              type="number"
              min={1}
              max={20}
              step={1}
              defaultValue={query?.limit ?? 10}
              required
            />
            <p className="muted">
              Start from the latest saved version. This resets the history page position.
            </p>
            <button className="primary-button" type="submit">
              Read latest history
            </button>
          </form>
        </div>
      </Panel>
      {inputError ? (
        <PageError error={inputError} />
      ) : query ? (
        <History query={query} />
      ) : (
        <Panel title="Choose a file" icon="database">
          <EmptyState
            title="Find saved versions"
            message="Enter a file ID to read its version history in the selected project."
          />
        </Panel>
      )}
    </>
  );
}

async function History({ query }: { query: ArtifactVersionsQuery }) {
  try {
    const result = await getWorkbenchArtifactVersions(query);
    const page = result.data;
    return (
      <>
        <Panel title="Saved versions" icon="database">
          <div className="side-detail artifact-details">
            <div className="artifact-badges">
              <Badge>Through version {page.snapshot_version}</Badge>
              <Badge tone="yellow">Metadata only</Badge>
            </div>
            <p>
              File {page.query.artifact_id} · Project {page.project_id}
            </p>
            <p>
              Newest first, up to {page.query.limit} versions per page.
              {page.query.before_version === undefined
                ? ''
                : ` Showing versions below ${page.query.before_version}.`}{' '}
              Older pages keep the same version ceiling. Use “Read latest history” to include new
              saves.
            </p>
            <p className="muted">
              This directory lists available saved records. Missing numbers do not prove versions
              never existed. File contents and download availability have not been checked. Open a
              version to read its full details and choose a download.
            </p>
            {page.items.length ? (
              <ol className="artifact-sources" aria-label="Saved file versions">
                {page.items.map((item) => (
                  <li key={item.version}>
                    <h2 className="detail-section-title">
                      <Link
                        className="panel-link"
                        href={artifactPageHref(page.query.artifact_id, item.version)}
                        prefetch={false}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Version {item.version}: {item.name} ↗
                      </Link>
                    </h2>
                    <div className="artifact-badges">
                      <Badge
                        tone={
                          {
                            public: 'green',
                            internal: 'blue',
                            confidential: 'yellow',
                            restricted: 'red',
                          }[item.classification]
                        }
                      >
                        {item.classification}
                      </Badge>
                      <Badge>{item.mime}</Badge>
                    </div>
                    <p>
                      {item.size.toLocaleString('en-US')} bytes · {item.source_ref_count} recorded
                      sources
                    </p>
                    <p>
                      Version saved: <time dateTime={item.updated_at}>{item.updated_at}</time>
                    </p>
                    <details>
                      <summary>
                        Saved hash and record information for version {item.version}
                      </summary>
                      <dl className="detail-grid checkpoint-detail-meta">
                        <div>
                          <dt>Saved SHA-256</dt>
                          <dd>
                            <code>{item.sha256}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>File first recorded</dt>
                          <dd>
                            <time dateTime={item.created_at}>{item.created_at}</time>
                          </dd>
                        </div>
                        <div>
                          <dt>Record trace</dt>
                          <dd>{item.trace_id}</dd>
                        </div>
                      </dl>
                    </details>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                title="No versions in this range"
                message="No saved records were returned for this page position. Start from the first page or read the latest history."
              />
            )}
            <nav className="heading-actions" aria-label="File history pages">
              {page.next_query && (
                <Link
                  className="panel-link"
                  prefetch={false}
                  href={artifactVersionsPageHref(page.next_query)}
                >
                  Older versions
                </Link>
              )}
              {page.query.before_version !== undefined && (
                <Link
                  className="panel-link"
                  prefetch={false}
                  href={artifactVersionsPageHref({
                    artifact_id: page.query.artifact_id,
                    limit: page.query.limit,
                    at_version: page.snapshot_version,
                  })}
                >
                  First page through version {page.snapshot_version}
                </Link>
              )}
              <Link
                className="panel-link"
                href={artifactPageHref(page.query.artifact_id)}
                prefetch={false}
                target="_blank"
                rel="noreferrer"
              >
                Current file details in a new tab ↗
              </Link>
            </nav>
            {!page.has_more && (
              <p className="muted">No older records were returned in this range.</p>
            )}
            <details>
              <summary>History read information</summary>
              <dl className="detail-grid checkpoint-detail-meta">
                <div>
                  <dt>Tenant</dt>
                  <dd>{page.tenant_id}</dd>
                </div>
                <div>
                  <dt>Workspace</dt>
                  <dd>{page.workspace_id}</dd>
                </div>
                <div>
                  <dt>Read trace</dt>
                  <dd>{result.trace_id}</dd>
                </div>
              </dl>
            </details>
          </div>
        </Panel>
      </>
    );
  } catch (error) {
    if (error instanceof WorkbenchApiError) {
      const title =
        error.code === 'ARTIFACT_LEGACY_UNVERIFIED'
          ? 'Saved history unavailable'
          : error.status === 404
            ? 'File unavailable'
            : error.status === 503
              ? 'History service unavailable'
              : undefined;
      if (title)
        return (
          <Panel title="File history" icon="database">
            <EmptyState title={title} message={error.message} trace={error.trace_id} />
          </Panel>
        );
    }
    return <PageError error={error} />;
  }
}
