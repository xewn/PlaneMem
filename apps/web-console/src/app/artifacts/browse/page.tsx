import Link from 'next/link';
import { type ArtifactRegistryQuery } from '@planemem/contracts';
import { PageError } from '../../../components/page-state';
import { Badge, EmptyState, Panel } from '../../../components/ui';
import { getWorkbenchArtifacts, WorkbenchApiError } from '../../../lib/server-api';
import { artifactPageHref, type ArtifactPageParams } from '../query';
import { artifactVersionsPageHref } from '../versions/query';
import { artifactRegistryPageHref, parseArtifactRegistryPageQuery } from './query';

export const dynamic = 'force-dynamic';

export default async function ArtifactDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<ArtifactPageParams>;
}) {
  const params = await searchParams;
  let query: ArtifactRegistryQuery | undefined;
  let inputError: unknown;
  let filters: ArtifactRegistryQuery = { limit: 20 };
  // Keep valid filters available when a pasted or expired page position is rejected.
  try {
    filters = parseArtifactRegistryPageQuery({
      query: params.query,
      classification: params.classification,
      limit: params.limit,
    });
  } catch {
    /* The filter form remains available with its defaults. */
  }
  try {
    query = parseArtifactRegistryPageQuery(params);
  } catch (error) {
    inputError = error;
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Project files</h1>
          <p>Find files in the selected project and open their saved details.</p>
        </div>
        <nav className="heading-actions" aria-label="Other file actions in new tabs">
          <Link
            className="panel-link"
            href="/artifacts"
            prefetch={false}
            target="_blank"
            rel="noreferrer"
          >
            Look up a file by ID ↗
          </Link>
          <Link
            className="panel-link"
            href="/artifacts/upload/new"
            prefetch={false}
            target="_blank"
            rel="noreferrer"
          >
            Prepare an upload ↗
          </Link>
        </nav>
      </div>
      <Panel title="Find project files" icon="search">
        <div className="side-detail">
          <form
            key={JSON.stringify(query ?? filters)}
            className="artifact-lookup-form"
            method="get"
            action="/artifacts/browse"
          >
            <label htmlFor="artifact-directory-name">File name contains</label>
            <input
              id="artifact-directory-name"
              name="query"
              type="search"
              defaultValue={filters.query ?? ''}
              maxLength={255}
              spellCheck={false}
            />
            <label htmlFor="artifact-directory-classification">Classification</label>
            <select
              id="artifact-directory-classification"
              name="classification"
              defaultValue={filters.classification ?? ''}
            >
              <option value="">All classifications I can read</option>
              <option value="public">Public</option>
              <option value="internal">Internal</option>
              <option value="confidential">Confidential</option>
              <option value="restricted">Restricted</option>
            </select>
            <label htmlFor="artifact-directory-limit">Files per page</label>
            <input
              id="artifact-directory-limit"
              name="limit"
              type="number"
              min={1}
              max={20}
              step={1}
              required
              defaultValue={filters.limit ?? 20}
            />
            <p className="muted">
              Search reads the first page with these filters. Use it again to see new files.
            </p>
            <button className="primary-button" type="submit">
              Search files
            </button>
          </form>
          <form method="get" action="/artifacts/browse">
            <button className="secondary-button" type="submit">
              Clear filters and reload
            </button>
          </form>
        </div>
      </Panel>
      {inputError ? <PageError error={inputError} /> : query ? <Directory query={query} /> : null}
    </>
  );
}

async function Directory({ query }: { query: ArtifactRegistryQuery }) {
  try {
    const result = await getWorkbenchArtifacts(query);
    const page = result.data;
    return (
      <Panel title="Files in this project" icon="database">
        <div className="side-detail artifact-details">
          <div className="artifact-badges">
            <Badge>{page.items.length} files on this page</Badge>
            <Badge tone="yellow">Metadata only</Badge>
          </div>
          <p>Project {page.project_id}</p>
          <p>
            {page.query.query === undefined
              ? 'Any file name'
              : `Name contains “${page.query.query}”`}
            {' · '}
            {page.query.classification ?? 'All readable classifications'}
            {' · '}Up to {page.query.limit} files per page
          </p>
          <p className="muted">
            Sorted by file ID, descending. Each page shows currently available records; files and
            access may change between pages. Open a saved version to review its details and choose a
            download. File contents have not been checked here.
          </p>
          {page.items.length ? (
            <ul className="artifact-sources" aria-label="Project files">
              {page.items.map((item) => (
                <li key={item.artifact_id}>
                  <h2 className="detail-section-title">
                    <Link
                      className="panel-link"
                      href={artifactPageHref(item.artifact_id, item.version)}
                      prefetch={false}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.name} — version {item.version} ↗
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
                    Saved: <time dateTime={item.updated_at}>{item.updated_at}</time>
                  </p>
                  <p className="muted">File ID: {item.artifact_id}</p>
                  <nav className="heading-actions" aria-label={`Related views for ${item.name}`}>
                    <Link
                      className="panel-link"
                      href={artifactPageHref(item.artifact_id)}
                      prefetch={false}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Read current details ↗
                    </Link>
                    <Link
                      className="panel-link"
                      href={artifactVersionsPageHref({
                        artifact_id: item.artifact_id,
                        at_version: item.version,
                      })}
                      prefetch={false}
                      target="_blank"
                      rel="noreferrer"
                    >
                      History through version {item.version} ↗
                    </Link>
                  </nav>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title={
                page.query.cursor === undefined
                  ? 'No matching files'
                  : 'No files at this page position'
              }
              message="No currently readable files matched this page. You can change the filters or use Search files to read the first page again."
            />
          )}
          {page.next_query ? (
            <nav className="heading-actions" aria-label="File directory pages">
              <Link
                className="panel-link"
                href={artifactRegistryPageHref(page.next_query)}
                prefetch={false}
              >
                Next page
              </Link>
            </nav>
          ) : page.items.length ? (
            <p className="muted">No further matching files were returned for this query.</p>
          ) : null}
          <details>
            <summary>Directory read information</summary>
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
    );
  } catch (error) {
    if (error instanceof WorkbenchApiError) {
      const title =
        error.code === 'ARTIFACT_LEGACY_UNVERIFIED'
          ? 'Saved file records unavailable'
          : error.status === 400
            ? 'Start again from the first page'
            : error.status === 404
              ? 'Project unavailable'
              : error.status === 503
                ? 'File directory unavailable'
                : undefined;
      if (title)
        return (
          <Panel title="Project files" icon="database">
            <EmptyState title={title} message={error.message} trace={error.trace_id} />
          </Panel>
        );
    }
    return <PageError error={error} />;
  }
}
