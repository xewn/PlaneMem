import Link from 'next/link';
import {
  proposalKinds,
  parseProposalListQuery,
  type ProposalDetail,
  type ProposalListQuery,
} from '@planemem/contracts';
import { Badge, Panel } from '../../components/ui';
import { PageError, toneFor } from '../../components/page-state';
import {
  listWorkbenchProposals,
  readWorkbenchProposal,
  readWorkbenchContextItem,
  getWorkbenchProposalSubmissionBinding,
} from '../../lib/server-api';
import { ProposalReviewForm } from './form';
import { ProposalCreateForm, type ProposalSourceSeed, type ProposalDraftSeed } from './create-form';
import type { ProposalSubmissionBinding } from './original-model';

type Params = Record<string, string | string[] | undefined>;
export default async function ProposalsPage({ searchParams }: { searchParams: Promise<Params> }) {
  try {
    const params = await searchParams;
    const status = ['proposed', 'verified', 'rejected', 'all'].includes(String(params.status))
      ? String(params.status)
      : 'proposed';
    const kind = proposalKinds.find((kind) => kind === params.kind);
    const before = typeof params.before === 'string' ? params.before : undefined;
    if (params.derived_from !== undefined && typeof params.derived_from !== 'string')
      throw new Error('Choose one original proposal to filter its direct revisions.');
    const derivedFrom = params.derived_from?.trim() || undefined;
    const query: ProposalListQuery = parseProposalListQuery({
      limit: 25,
      ...(status === 'all' ? {} : { status: status as 'proposed' | 'verified' | 'rejected' }),
      ...(kind ? { kind } : {}),
      ...(before ? { before } : {}),
      ...(derivedFrom ? { derived_from: derivedFrom } : {}),
    });
    const page = (await listWorkbenchProposals(query)).data;
    let commandBinding: ProposalSubmissionBinding | undefined;
    let bindingError: unknown;
    if (page.create_allowed || page.review_allowed) {
      try {
        commandBinding = await getWorkbenchProposalSubmissionBinding();
      } catch (error) {
        bindingError = error;
      }
    }
    const sourceId = typeof params.source === 'string' ? params.source : undefined;
    const originId = typeof params.from === 'string' ? params.from : undefined;
    let originSeed: ProposalDraftSeed | undefined;
    let originDetail: ProposalDetail | undefined;
    let sourceSeed: ProposalSourceSeed | undefined;
    let sourceError: unknown;
    let sourceMessage: string | undefined;
    if (sourceId !== undefined && originId !== undefined)
      sourceMessage = 'Choose either a source item or an original proposal to start a draft.';
    if (originId !== undefined && sourceId === undefined && page.create_allowed) {
      try {
        const original = (await readWorkbenchProposal(originId)).data;
        originDetail = original;
        const {
          proposal_id,
          revision,
          kind,
          title,
          content,
          classification,
          source_refs,
          status,
          expires_at,
        } = original.proposal;
        originSeed = {
          proposal_id,
          revision,
          kind,
          title,
          content,
          classification,
          source_refs,
          status,
          expires_at,
          sources_current: original.sources_current,
        };
      } catch (error) {
        sourceError = error;
      }
    }
    if (sourceId !== undefined && originId === undefined && page.create_allowed) {
      try {
        const source = (await readWorkbenchContextItem(sourceId)).data;
        if (
          source.status === 'excluded' ||
          source.status === 'expired' ||
          source.sources_current === false ||
          (source.expires_at !== null && Date.parse(source.expires_at) <= Date.now())
        ) {
          sourceMessage =
            'This source is excluded, expired or has an invalid local source chain. Open its current item before preparing a proposal.';
        } else {
          sourceSeed = {
            id: source.id,
            version: source.version,
            title: source.title,
            classification: source.classification,
          };
        }
      } catch (error) {
        sourceError = error;
      }
    }
    const selectedId =
      typeof params.proposal === 'string'
        ? params.proposal
        : (originId ?? page.proposals[0]?.proposal_id);
    let selected: ProposalDetail | undefined;
    let detailError: unknown;
    if (selectedId) {
      try {
        selected =
          originDetail?.proposal.proposal_id === selectedId
            ? originDetail
            : (await readWorkbenchProposal(selectedId)).data;
      } catch (error) {
        detailError = error;
      }
    }
    if (selected?.review_allowed && !commandBinding && bindingError === undefined) {
      try {
        commandBinding = await getWorkbenchProposalSubmissionBinding();
      } catch (error) {
        bindingError = error;
      }
    }
    const href = (id?: string, next: string | null | undefined = before) => {
      const search = new URLSearchParams({ status });
      if (kind) search.set('kind', kind);
      if (derivedFrom) search.set('derived_from', derivedFrom);
      if (id) search.set('proposal', id);
      if (next) search.set('before', next);
      return '/proposals?' + search;
    };
    const proposal = selected?.proposal;
    const expired = proposal ? Date.parse(proposal.expires_at) <= Date.now() : false;
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Proposals</h1>
            <p>Review sourced suggestions and record an explicit decision.</p>
          </div>
          <Badge tone="cyan">{page.proposals.length} on this page</Badge>
        </div>
        <p>
          <Link
            href="/proposals/recover"
            prefetch={false}
            target="_blank"
            rel="noopener noreferrer"
          >
            Recover an original proposal submission ↗
          </Link>
          {' · '}
          <Link
            href="/proposals/recover-review"
            prefetch={false}
            target="_blank"
            rel="noopener noreferrer"
          >
            Recover an original review ↗
          </Link>
        </p>
        {page.create_allowed && (
          <Panel title="Submit a proposal" icon="decision">
            <details
              className="side-detail"
              open={sourceId !== undefined || originId !== undefined}
            >
              <summary>Prepare a sourced suggestion for review</summary>
              {sourceError !== undefined && <PageError error={sourceError} />}
              {bindingError !== undefined && <PageError error={bindingError} />}
              {sourceMessage && <p role="status">{sourceMessage}</p>}
              {sourceError === undefined && sourceMessage === undefined && commandBinding ? (
                <ProposalCreateForm
                  key={
                    'new:' +
                    JSON.stringify(commandBinding) +
                    ':' +
                    (sourceId ?? '') +
                    ':' +
                    (originId ?? '') +
                    ':' +
                    (typeof params.proposal === 'string' ? params.proposal : '')
                  }
                  initialKey={'proposal-create-' + crypto.randomUUID()}
                  binding={commandBinding}
                  restricted={page.restricted_read === true}
                  {...(sourceSeed ? { source: sourceSeed } : {})}
                  {...(originSeed ? { origin: originSeed } : {})}
                />
              ) : (
                <div className="heading-actions">
                  {sourceId !== undefined && (
                    <Link
                      className="panel-link"
                      href={'/context?item=' + encodeURIComponent(sourceId ?? '')}
                    >
                      Open source item
                    </Link>
                  )}
                  {originId !== undefined && (
                    <Link
                      className="panel-link"
                      href={'/proposals?status=all&proposal=' + encodeURIComponent(originId)}
                    >
                      Open original proposal
                    </Link>
                  )}
                  <Link className="panel-link" href="/proposals">
                    Start with other sources
                  </Link>
                </div>
              )}
            </details>
          </Panel>
        )}
        {(sourceId !== undefined || originId !== undefined) && !page.create_allowed && (
          <p role="status">Your account is not authorized to submit proposals.</p>
        )}
        <form
          method="get"
          action="/proposals"
          className="filters work-item-filters"
          key={status + ':' + kind + ':' + derivedFrom}
        >
          <select name="status" aria-label="Proposal status" defaultValue={status}>
            <option value="proposed">Awaiting review</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
            <option value="all">All statuses</option>
          </select>
          <select name="kind" aria-label="Proposal kind" defaultValue={kind ?? ''}>
            <option value="">All kinds</option>
            {proposalKinds.map((kind) => (
              <option key={kind}>{kind}</option>
            ))}
          </select>
          <label className="filter-input">
            <input
              name="derived_from"
              maxLength={26}
              defaultValue={derivedFrom ?? ''}
              aria-label="Original proposal ID"
              placeholder="Original proposal ID (direct revisions)"
            />
          </label>
          <button className="secondary-button">Apply filters</button>
          {before && <Link href={href(undefined, null)}>First page</Link>}
        </form>
        {derivedFrom && (
          <p className="muted">
            Showing visible direct revisions of{' '}
            <Link
              className="panel-link"
              href={'/proposals?status=all&proposal=' + encodeURIComponent(derivedFrom)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {derivedFrom}
            </Link>
            . Further revisions of those proposals are listed from their own details.{' '}
            <Link
              className="panel-link"
              href={'/proposals?' + new URLSearchParams({ status, ...(kind ? { kind } : {}) })}
            >
              Clear original proposal filter
            </Link>
          </p>
        )}
        <div className="context-layout">
          <Panel title={derivedFrom ? 'Direct revisions' : 'Submitted proposals'} icon="decision">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Kind</th>
                    <th>Status</th>
                    <th>Revision</th>
                  </tr>
                </thead>
                <tbody>
                  {page.proposals.map((item) => (
                    <tr
                      key={item.proposal_id}
                      className={item.proposal_id === selectedId ? 'selected' : undefined}
                    >
                      <td>
                        <Link className="panel-link" href={href(item.proposal_id)}>
                          {item.title}
                        </Link>
                      </td>
                      <td>{item.kind}</td>
                      <td>
                        <Badge tone={toneFor(item.status)}>{item.status}</Badge>
                      </td>
                      <td>{item.revision}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!page.proposals.length && (
                <div className="empty-state">
                  <h3>No matching proposals</h3>
                  <p>
                    {derivedFrom
                      ? 'No visible direct revisions match this page and its filters. Adjust the filters or return to the first page.'
                      : 'Submitted suggestions appear here for review. Adjust the filters to see other decisions.'}
                  </p>
                </div>
              )}
            </div>
            {page.next_before && (
              <div className="side-detail">
                <Link className="panel-link" href={href(undefined, page.next_before)}>
                  Next page
                </Link>
              </div>
            )}
          </Panel>
          <Panel title="Review details" icon="audit">
            <div className="side-detail">
              {detailError !== undefined && <PageError error={detailError} />}
              {proposal && (
                <>
                  {!page.proposals.some((item) => item.proposal_id === proposal.proposal_id) && (
                    <p role="status">
                      The selected proposal is outside this page or the current filters.
                    </p>
                  )}
                  <h2>{proposal.title}</h2>
                  <Link
                    className="panel-link"
                    href={
                      '/proposals?status=all&proposal=' + encodeURIComponent(proposal.proposal_id)
                    }
                  >
                    Link to this proposal
                  </Link>
                  <div className="heading-actions">
                    <Badge tone={toneFor(proposal.status)}>{proposal.status}</Badge>
                    <Badge tone="neutral">{proposal.classification}</Badge>
                  </div>
                  <p className="muted">
                    Revision {proposal.revision} · Submitted {proposal.created_at} · Expires{' '}
                    {proposal.expires_at}
                  </p>
                  <pre className="context-content">{proposal.content}</pre>
                  <p>
                    <Link
                      className="panel-link"
                      href={
                        '/proposals?status=all&derived_from=' +
                        encodeURIComponent(proposal.proposal_id)
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View direct revisions of this proposal
                    </Link>
                  </p>
                  {page.create_allowed && (
                    <p>
                      <Link
                        className="panel-link"
                        href={
                          '/proposals?status=all&from=' + encodeURIComponent(proposal.proposal_id)
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Prepare a revised proposal
                      </Link>
                    </p>
                  )}
                  {expired && proposal.status === 'proposed' && (
                    <p role="status">
                      This proposal expired and can only be rejected. Submit a fresh proposal for
                      confirmation.
                    </p>
                  )}
                  {!selected!.sources_current && (
                    <p role="status">
                      The local source chain changed, is unavailable or has no recorded dependency
                      snapshot. The submitted evidence cannot currently be confirmed.
                    </p>
                  )}
                  <h3>Provenance</h3>
                  {proposal.provenance.derived_from && (
                    <p>
                      Derived from{' '}
                      <Link
                        className="panel-link"
                        href={
                          '/proposals?status=all&proposal=' +
                          encodeURIComponent(proposal.provenance.derived_from.proposal_id)
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {proposal.provenance.derived_from.proposal_id}
                      </Link>{' '}
                      · recorded revision {proposal.provenance.derived_from.revision}. The link
                      shows its current state; its approval does not apply to this proposal.{' '}
                      <Link
                        className="panel-link"
                        href={
                          '/proposals?status=all&derived_from=' +
                          encodeURIComponent(proposal.provenance.derived_from.proposal_id)
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View revisions of the same original
                      </Link>
                    </p>
                  )}
                  <p>
                    Model: {proposal.provenance.model_version}
                    <br />
                    Prompt: {proposal.provenance.prompt_version}
                  </p>
                  {proposal.provenance.warnings.map((warning) => (
                    <p key={warning} role="status">
                      Warning: {warning}
                    </p>
                  ))}
                  <h3>Sources</h3>
                  <p className="muted">
                    Only linked context items are checked automatically. Review external sources
                    directly.
                  </p>
                  <ul>
                    {proposal.source_refs.map((source, index) => (
                      <li key={index}>
                        {source.type}: {source.id}
                        {source.revision !== undefined ? ' · revision ' + source.revision : ''}
                        {source.type === 'context-item' && (
                          <>
                            {' '}
                            ·{' '}
                            <Link
                              className="panel-link"
                              href={'/context?item=' + encodeURIComponent(source.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Open current item
                            </Link>
                            {Number.isSafeInteger(source.revision) &&
                              (source.revision ?? 0) > 0 && (
                                <>
                                  {' '}
                                  ·{' '}
                                  <Link
                                    className="panel-link"
                                    href={
                                      '/context/history?item=' +
                                      encodeURIComponent(source.id) +
                                      '&version=' +
                                      source.revision
                                    }
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    View submitted revision
                                  </Link>
                                </>
                              )}
                          </>
                        )}
                        {source.uri && externalUri(source.uri) && (
                          <>
                            {' '}
                            ·{' '}
                            <a
                              className="panel-link"
                              href={externalUri(source.uri)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Open source
                            </a>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="muted">Submitted by {proposal.created_by}</p>
                  {proposal.status !== 'proposed' ? (
                    <>
                      <h3>Recorded decision</h3>
                      <p>{proposal.review_reason}</p>
                      <p className="muted">
                        {proposal.reviewed_by} · {proposal.reviewed_at}
                      </p>
                    </>
                  ) : selected!.review_allowed && commandBinding ? (
                    <ProposalReviewForm
                      key={
                        JSON.stringify(commandBinding) +
                        ':' +
                        proposal.proposal_id +
                        ':' +
                        proposal.revision
                      }
                      binding={commandBinding}
                      id={proposal.proposal_id}
                      revision={proposal.revision}
                      canConfirm={!expired && selected!.sources_current}
                      initialKey={'proposal-review-' + crypto.randomUUID()}
                    />
                  ) : selected!.review_allowed ? (
                    <>
                      {bindingError !== undefined && <PageError error={bindingError} />}
                      <p>
                        Review preparation requires the original project and account identity.
                        Reload this page after restoring access.
                      </p>
                    </>
                  ) : (
                    <p>Your account is not authorized to review proposals.</p>
                  )}
                </>
              )}
              {!proposal && detailError === undefined && (
                <p className="muted">Select a proposal to view its sources and review details.</p>
              )}
            </div>
          </Panel>
        </div>
      </>
    );
  } catch (error) {
    return (
      <>
        <div className="page-heading">
          <h1>Proposals</h1>
        </div>
        <PageError error={error} />
        <Link className="panel-link" href="/proposals/recover" prefetch={false}>
          Recover an original submission
        </Link>
        <Link className="panel-link" href="/proposals/recover-review" prefetch={false}>
          Recover an original review
        </Link>
        <Link className="panel-link" href="/proposals">
          Return to proposals without filters
        </Link>
      </>
    );
  }
}

function externalUri(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password)
      return url.href;
  } catch {
    /* Source identifiers are not necessarily web addresses. */
  }
}
