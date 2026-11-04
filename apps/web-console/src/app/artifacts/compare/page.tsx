import Link from 'next/link';
import { isUlid, type SourceRef } from '@planemem/contracts';
import { PageError } from '../../../components/page-state';
import { Badge, EmptyState, Panel } from '../../../components/ui';
import { getWorkbenchArtifactComparison } from '../../../lib/artifact-comparison-server';
import { artifactPageHref, type ArtifactPageParams } from '../query';
import { artifactVersionsPageHref } from '../versions/query';
import {
  artifactComparisonHref,
  parseArtifactComparisonPageQuery,
  parseArtifactComparisonQuery,
  type ArtifactComparisonQuery,
} from './model';

export const dynamic = 'force-dynamic';

export default async function ArtifactComparisonPage({
  searchParams,
}: {
  searchParams: Promise<ArtifactPageParams>;
}) {
  const params = await searchParams;
  let query: ArtifactComparisonQuery | undefined;
  let failure: unknown;
  try {
    const selection = parseArtifactComparisonPageQuery(params);
    if (
      selection.artifact_id !== undefined &&
      selection.from_version !== undefined &&
      selection.to_version !== undefined
    )
      query = parseArtifactComparisonQuery(selection);
  } catch (error) {
    failure = error;
  }
  const artifactId = isUlid(params.artifact) ? params.artifact : '';
  const versionValue = (key: 'from_version' | 'to_version') => {
    const value = params[key];
    return typeof value === 'string' && value.length <= 16 ? value : '';
  };
  const from = versionValue('from_version');
  const to = versionValue('to_version');
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Compare saved file versions</h1>
          <p>Review differences between two selected records of the same file.</p>
        </div>
        <Link
          className="panel-link"
          href={
            artifactId
              ? artifactVersionsPageHref({ artifact_id: artifactId })
              : '/artifacts/versions'
          }
          prefetch={false}
          target="_blank"
          rel="noreferrer"
        >
          Browse saved versions ↗
        </Link>
      </div>
      <Panel title="Choose two versions" icon="search">
        <div className="side-detail">
          <form
            key={JSON.stringify([artifactId, from, to])}
            className="artifact-lookup-form"
            action="/artifacts/compare"
            method="get"
          >
            <label htmlFor="artifact-compare-id">File ID</label>
            <input
              id="artifact-compare-id"
              name="artifact"
              defaultValue={artifactId}
              required
              minLength={26}
              maxLength={26}
              pattern="[0-9A-HJKMNP-TV-Z]{26}"
              spellCheck={false}
              autoCapitalize="characters"
            />
            <label htmlFor="artifact-compare-from">Base version</label>
            <input
              id="artifact-compare-from"
              name="from_version"
              type="text"
              inputMode="numeric"
              pattern="[1-9][0-9]{0,15}"
              maxLength={16}
              defaultValue={from}
              required
            />
            <label htmlFor="artifact-compare-to">Comparison version</label>
            <input
              id="artifact-compare-to"
              name="to_version"
              type="text"
              inputMode="numeric"
              pattern="[1-9][0-9]{0,15}"
              maxLength={16}
              defaultValue={to}
              required
            />
            <p className="muted">
              Choose two different saved version numbers. Their order is kept; neither selection
              changes to the latest version.
            </p>
            <button className="primary-button" type="submit">
              Compare selected versions
            </button>
          </form>
        </div>
      </Panel>
      {failure ? (
        <PageError error={failure} />
      ) : query ? (
        <Comparison query={query} />
      ) : (
        <Panel title="Select both records" icon="database">
          <EmptyState
            title="Ready to choose versions"
            message="Enter both version numbers to read their saved details. No file content is opened by this comparison."
          />
        </Panel>
      )}
    </>
  );
}

const valueStyle = {
  whiteSpace: 'pre-wrap' as const,
  overflowWrap: 'anywhere' as const,
  minWidth: 180,
  maxWidth: 360,
};

async function Comparison({ query }: { query: ArtifactComparisonQuery }) {
  try {
    const result = await getWorkbenchArtifactComparison(query);
    const { from, to, comparison } = result;
    return (
      <>
        <Panel
          title={`Version ${query.from_version} → version ${query.to_version}`}
          icon="database"
        >
          <div className="side-detail artifact-details">
            <Badge tone="yellow">Saved metadata only</Badge>
            <p>
              {comparison.content_descriptor_matches
                ? 'Saved content hash and size match.'
                : 'Saved content hash or size differs.'}{' '}
              File bytes and download availability have not been checked.
            </p>
            <p>
              {comparison.changed_fields} of {comparison.rows.length} displayed fields differ,
              including saved dates and trace. {comparison.changed_source_positions} source
              positions differ.
            </p>
            <nav className="heading-actions" aria-label="Selected version details">
              <Link
                className="panel-link"
                href={artifactPageHref(query.artifact_id, query.from_version)}
                prefetch={false}
                target="_blank"
                rel="noreferrer"
              >
                Open base version {query.from_version} ↗
              </Link>
              <Link
                className="panel-link"
                href={artifactPageHref(query.artifact_id, query.to_version)}
                prefetch={false}
                target="_blank"
                rel="noreferrer"
              >
                Open comparison version {query.to_version} ↗
              </Link>
              <Link
                className="panel-link"
                href={artifactComparisonHref({
                  artifact_id: query.artifact_id,
                  from_version: query.to_version,
                  to_version: query.from_version,
                })}
                prefetch={false}
                target="_blank"
                rel="noreferrer"
              >
                Compare in reverse order ↗
              </Link>
            </nav>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <caption>Saved fields for the selected versions</caption>
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Base: {query.from_version}</th>
                  <th scope="col">Comparison: {query.to_version}</th>
                  <th scope="col">Difference</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td style={valueStyle}>{row.before}</td>
                    <td style={valueStyle}>{row.after}</td>
                    <td>{row.changed ? 'Changed' : 'Same'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Source references by position" icon="database">
          <div className="side-detail artifact-details">
            <p>
              References keep their saved order and duplicates. Reordering appears as changed
              positions. Reference targets, permissions and availability have not been checked.
            </p>
            <p>
              Base: {from.data.artifact.source_refs.length} references · Comparison:{' '}
              {to.data.artifact.source_refs.length} references
            </p>
          </div>
          {comparison.sources.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <caption>
                  Complete recorded source references; addresses are displayed as text
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Position</th>
                    <th scope="col">Base: {query.from_version}</th>
                    <th scope="col">Comparison: {query.to_version}</th>
                    <th scope="col">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.sources.map((row) => (
                    <tr key={row.position}>
                      <th scope="row">{row.position}</th>
                      <td style={valueStyle}>
                        <SourceReference source={row.before} />
                      </td>
                      <td style={valueStyle}>
                        <SourceReference source={row.after} />
                      </td>
                      <td>
                        {
                          {
                            same: 'Same',
                            changed: 'Changed',
                            added: 'Added at this position',
                            removed: 'Removed at this position',
                          }[row.status]
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No recorded sources"
              message="Neither selected record contains source references."
            />
          )}
        </Panel>
        <Panel title="Comparison read information" icon="database">
          <div className="side-detail artifact-details">
            <p>
              Both saved records were read separately using the same signed-in session. This is not
              a single database snapshot and does not authorize restoring or uploading a version.
            </p>
            <dl className="detail-grid checkpoint-detail-meta">
              <div>
                <dt>File ID</dt>
                <dd>{query.artifact_id}</dd>
              </div>
              <div>
                <dt>Project</dt>
                <dd>{from.data.artifact.project_id}</dd>
              </div>
              <div>
                <dt>Tenant</dt>
                <dd>{from.data.artifact.tenant_id}</dd>
              </div>
              <div>
                <dt>Workspace</dt>
                <dd>{from.data.artifact.workspace_id}</dd>
              </div>
              <div>
                <dt>Base read trace</dt>
                <dd>{from.trace_id}</dd>
              </div>
              <div>
                <dt>Comparison read trace</dt>
                <dd>{to.trace_id}</dd>
              </div>
            </dl>
          </div>
        </Panel>
      </>
    );
  } catch (error) {
    return <PageError error={error} />;
  }
}

function SourceReference({ source }: { source: SourceRef | undefined }) {
  if (!source) return <span>No reference at this position</span>;
  return (
    <dl>
      <div>
        <dt>Type</dt>
        <dd>{source.type}</dd>
      </div>
      <div>
        <dt>ID</dt>
        <dd>{source.id}</dd>
      </div>
      <div>
        <dt>Revision</dt>
        <dd>{source.revision ?? 'Not recorded'}</dd>
      </div>
      <div>
        <dt>Address</dt>
        <dd>{source.uri ?? 'Not recorded'}</dd>
      </div>
    </dl>
  );
}
