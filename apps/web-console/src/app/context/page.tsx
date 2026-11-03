import Link from 'next/link';
import type {
  ContextPackReceipt,
  ContextItemConfirmation,
  ContextSourceCheck,
  ContextSourceReferenceCheck,
  SourceRef,
  ContextConfirmationReadiness,
} from '@planemem/contracts';
import { Icon } from '../../components/icons';
import { PageError, numberValue, textValue, toneFor } from '../../components/page-state';
import { Badge, Panel, Progress } from '../../components/ui';
import {
  queryWorkbench,
  readWorkbenchContextPack,
  readWorkbenchContextItem,
  readArchivedWorkbenchContextItem,
  WorkbenchApiError,
} from '../../lib/server-api';
import { CompilePackForm } from './form';
import { PackExclusions } from './pack-exclusions';
import { ContextSourceStatus } from './source-status';
import {
  ArchiveContextItem,
  RestoreContextItem,
  ConfirmContextItem,
  ContextItemEditor,
} from './item-form';

type ContextItem = Record<string, unknown> & {
  confirmation?: ContextItemConfirmation | null;
  confirm_allowed?: boolean;
  sources_current?: boolean;
  source_check?: ContextSourceCheck;
  source_checks?: ContextSourceReferenceCheck[];
  source_refs?: SourceRef[];
  confirmation_readiness?: ContextConfirmationReadiness;
};
type SearchParams = Record<string, string | string[] | undefined>;
const layers = [
  ['L0', 'Project Brief', 'cyan'],
  ['L1', 'Current Work State', 'green'],
  ['L2', 'Confirmed Facts', 'yellow'],
  ['L3', 'Recent Activity', 'blue'],
  ['L4', 'On-demand Retrieval', 'purple'],
] as const;
const classifications = ['public', 'internal', 'confidential', 'restricted'];
const statuses = ['confirmed', 'proposed', 'expired', 'excluded'];

export default async function ContextPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  try {
    const params = await searchParams;
    const query = typeof params.q === 'string' ? params.q.trim().slice(0, 500) : '';
    const layer = layers.find(([value]) => value === params.layer)?.[0] ?? '';
    const classification = classifications.find((value) => value === params.classification) ?? '';
    const status = statuses.find((value) => value === params.status) ?? '';
    const itemType = typeof params.type === 'string' ? params.type.trim().slice(0, 500) : '';
    const packId = typeof params.pack === 'string' ? params.pack : undefined;
    const archived = params.view === 'archived';
    const cursor = typeof params.cursor === 'string' ? params.cursor : undefined;
    const response = await queryWorkbench<ContextItem[]>('context', {
      query,
      layer,
      classification,
      status,
      item_type: itemType,
      limit: 25,
      archived,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const items = response.data;
    const selectedId = typeof params.item === 'string' ? params.item : items[0]?.id;
    let selected: ContextItem | undefined;
    let itemError: unknown;
    if (typeof selectedId === 'string') {
      try {
        selected = {
          ...(
            await (archived
              ? readArchivedWorkbenchContextItem(selectedId)
              : readWorkbenchContextItem(selectedId))
          ).data,
        };
      } catch (error) {
        itemError = error;
      }
    }
    let saved: ContextPackReceipt | undefined;
    let packMessage: string | undefined;
    let packNeedsReplacement = false;
    let packError: unknown;
    try {
      saved = (await readWorkbenchContextPack(packId)).data;
    } catch (error) {
      if (error instanceof WorkbenchApiError && [404, 409, 410].includes(error.status ?? 0)) {
        packMessage = error.message;
        packNeedsReplacement =
          (error.status === 409 && error.code === 'CONTEXT_PACK_STALE') ||
          (error.status === 410 && error.code === 'CONTEXT_PACK_EXPIRED');
      } else packError = error;
    }
    function pageHref(id?: string, pageCursor?: string) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries({
        q: query,
        layer,
        classification,
        status,
        type: itemType,
        pack: packId ?? '',
        item: id ?? '',
        cursor: pageCursor ?? '',
        view: archived ? 'archived' : '',
      }))
        if (value) search.set(key, value);
      return '/context?' + search;
    }
    const source = selected ? sourceUrl(selected) : undefined;
    const confirmationReadiness = !archived ? selected?.confirmation_readiness : undefined;
    const showConfirmationSources =
      selected?.sources_current === true && confirmationReadiness !== undefined;
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Context</h1>
            <p>Browse project knowledge and compile a saved context pack for the next session.</p>
          </div>
          <div className="heading-actions">
            <Link className="secondary-button" href="/context/index" prefetch={false}>
              Manage indexes
            </Link>
            {archived && <Badge tone="neutral">Archived</Badge>}
            <Badge tone="cyan">{items.length} on this page</Badge>
          </div>
        </div>
        {response.context_permissions?.write && (
          <Panel title="Add project knowledge" icon="context">
            <details className="side-detail">
              <summary>Add a proposed context item</summary>
              <ContextItemEditor
                key={'new-' + String(selected?.id ?? '') + ':' + String(selected?.version ?? '')}
                initialKey={'context-create-' + crypto.randomUUID()}
                restricted={response.context_permissions.restricted}
              />
            </details>
          </Panel>
        )}
        <form
          className="filters work-item-filters"
          action="/context"
          method="get"
          key={JSON.stringify([query, layer, classification, status, itemType, archived])}
        >
          {packId && <input type="hidden" name="pack" value={packId} />}
          <select
            className="filter-chip"
            name="view"
            aria-label="Archive view"
            defaultValue={archived ? 'archived' : 'active'}
          >
            <option value="active">Active items</option>
            <option value="archived">Archived items</option>
          </select>
          <label className="filter-input">
            <Icon name="search" />
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Title, content or source"
              aria-label="Search context"
            />
          </label>
          <select
            className="filter-chip"
            name="layer"
            aria-label="Context layer"
            defaultValue={layer}
          >
            <option value="">All layers</option>
            {layers.map(([id]) => (
              <option key={id}>{id}</option>
            ))}
          </select>
          <select
            className="filter-chip"
            name="classification"
            aria-label="Classification"
            defaultValue={classification}
          >
            <option value="">All classifications</option>
            {classifications.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            className="filter-chip"
            name="status"
            aria-label="Context status"
            defaultValue={status}
          >
            <option value="">All statuses</option>
            {statuses.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <label className="filter-input">
            <input
              name="type"
              defaultValue={itemType}
              placeholder="Item type"
              aria-label="Item type"
            />
          </label>
          <button className="secondary-button" type="submit">
            Apply filters
          </button>
          {(query || layer || classification || status || itemType) && (
            <Link className="panel-link" href={archived ? '/context?view=archived' : '/context'}>
              Clear filters
            </Link>
          )}
        </form>
        {archived && (
          <p className="muted">
            Archived items stay out of new context packs. Restore an item to review and edit it
            again.
          </p>
        )}
        <div className="layer-grid">
          {layers.map(([id, label, tone]) => {
            const group = items.filter((item) => item.layer === id);
            const confidence = group.length
              ? Math.round(
                  (group.reduce((sum, item) => sum + numberValue(item.confidence), 0) /
                    group.length) *
                    100,
                )
              : 0;
            return (
              <section className={'panel layer-card ' + tone} key={id}>
                <Badge tone={tone}>{id}</Badge>
                <h3>{label}</h3>
                <div className="layer-stat">{group.length}</div>
                <small>on this page · confidence {confidence}%</small>
                <Progress value={confidence} tone={tone} />
              </section>
            );
          })}
        </div>
        <div className="context-layout">
          <Panel
            title={
              (archived ? 'Archived Items (' : 'Context Items (') + items.length + ' on this page)'
            }
            icon="context"
          >
            {itemError !== undefined && <PageError error={itemError} />}
            {itemError instanceof WorkbenchApiError &&
              itemError.status === 404 &&
              typeof selectedId === 'string' && (
                <p className="side-detail">
                  <Link
                    className="panel-link"
                    href={
                      '/context?item=' +
                      encodeURIComponent(selectedId) +
                      (archived ? '' : '&view=archived')
                    }
                  >
                    {archived
                      ? 'Look for this item in the active view'
                      : 'Look for this item in the archived view'}
                  </Link>
                </p>
              )}
            {selected && !items.some((item) => item.id === selected?.id) && (
              <p role="status" className="side-detail">
                The selected item is shown below. It is outside this page or the current filters.
              </p>
            )}
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Layer</th>
                    <th>Classification</th>
                    <th>Status</th>
                    <th>Confidence</th>
                    <th>Priority</th>
                    {archived && <th>Archived</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={String(item.id)}
                      className={selected?.id === item.id ? 'selected' : undefined}
                    >
                      <td>
                        <Link
                          className="panel-link"
                          href={pageHref(String(item.id), cursor)}
                          aria-current={selected?.id === item.id ? 'true' : undefined}
                        >
                          {textValue(item.title)}
                        </Link>
                      </td>
                      <td>{textValue(item.item_type)}</td>
                      <td>
                        <Badge tone={toneFor(item.layer)}>{textValue(item.layer)}</Badge>
                      </td>
                      <td>
                        <Badge tone={item.classification === 'restricted' ? 'red' : 'neutral'}>
                          {textValue(item.classification)}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={toneFor(item.status)}>{textValue(item.status)}</Badge>
                      </td>
                      <td>{numberValue(item.confidence).toFixed(2)}</td>
                      <td>{textValue(item.priority)}</td>
                      {archived && <td>{textValue(item.archived_at)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!items.length && (
                <div className="empty-state">
                  <h3>No matching context</h3>
                  <p>
                    {cursor
                      ? 'No more items on this page. Return to the first page to refresh the list.'
                      : archived
                        ? 'No archived items match these filters.'
                        : response.context_permissions?.write
                          ? 'Adjust the filters or add project knowledge above.'
                          : 'Adjust the filters or ask a project contributor to add knowledge.'}
                  </p>
                </div>
              )}
            </div>
            <nav className="heading-actions side-detail" aria-label="Context pages">
              {cursor && (
                <Link className="panel-link" href={pageHref()}>
                  First page
                </Link>
              )}
              {response.next_cursor && (
                <Link className="panel-link" href={pageHref(undefined, response.next_cursor)}>
                  Next page
                </Link>
              )}
            </nav>
            {selected && (
              <div className="side-detail">
                <h2>{textValue(selected.title)}</h2>
                <p className="muted">{textValue(selected.source_ref)}</p>
                <div className="source-line">
                  <span>Version</span>
                  <strong>{numberValue(selected.version)}</strong>
                </div>
                {archived && (
                  <div className="source-line">
                    <span>Archived</span>
                    <span>{textValue(selected.archived_at)}</span>
                  </div>
                )}
                <div className="source-line">
                  <span>Expires</span>
                  <span>{textValue(selected.expires_at, 'No expiry set')}</span>
                </div>
                <pre className="context-content">
                  {typeof selected.content === 'string'
                    ? selected.content
                    : JSON.stringify(selected.content, null, 2)}
                </pre>
                {source && (
                  <a className="panel-link" href={source} target="_blank" rel="noopener noreferrer">
                    Open source <Icon name="external" />
                  </a>
                )}
                {!archived && selected.source_check && (
                  <div role="status">
                    <p>
                      {selected.sources_current
                        ? 'The local source chain is current at this check.'
                        : 'The local source chain cannot currently support this item: ' +
                          selected.source_check.state +
                          '.'}
                    </p>
                    <p className="muted">
                      Checked {selected.source_check.checked_at}. External evidence still requires
                      review.
                      {!selected.sources_current &&
                        ' This item is excluded from new saved context packs and cannot be confirmed until its sources are corrected.'}
                    </p>
                  </div>
                )}
                {confirmationReadiness && (
                  <div role="status">
                    <h3>Confirmation readiness</h3>
                    <p>
                      {confirmationReadiness.sources_current
                        ? 'Local sources meet the confirmation requirements at this check. Review the content and external evidence before confirming.'
                        : 'This item is not ready for confirmation: ' +
                          confirmationReadiness.source_check.state +
                          '.'}
                    </p>
                    {selected.source_refs?.length === 0 && (
                      <p>Add at least one traceable source before confirming this item.</p>
                    )}
                    <p className="muted">
                      Checked {confirmationReadiness.source_check.checked_at}.
                      {confirmationReadiness.sources_current &&
                        confirmationReadiness.effective_expires_at &&
                        ' The earliest local expiry is ' +
                          confirmationReadiness.effective_expires_at +
                          '.'}{' '}
                      This is a preview; saving a confirmation checks the sources again.
                    </p>
                  </div>
                )}
                {!archived && selected.source_checks && (
                  <ContextSourceStatus
                    sources={selected.source_refs ?? []}
                    checks={
                      showConfirmationSources
                        ? (confirmationReadiness?.source_checks ?? [])
                        : selected.source_checks
                    }
                    current={
                      showConfirmationSources
                        ? confirmationReadiness?.sources_current === true
                        : selected.sources_current === true
                    }
                    confirmation={showConfirmationSources}
                  />
                )}
                <details>
                  <summary>View item JSON and source references</summary>
                  <pre className="context-content">{JSON.stringify(selected, null, 2)}</pre>
                </details>
                <p>
                  <Link
                    className="panel-link"
                    href={'/context/history?item=' + encodeURIComponent(String(selected.id))}
                  >
                    View recorded version history
                  </Link>
                </p>
                {!archived && response.context_permissions?.propose && (
                  <p>
                    <Link
                      className="panel-link"
                      href={'/proposals?source=' + encodeURIComponent(String(selected.id))}
                    >
                      Prepare a proposal using this source
                    </Link>
                  </p>
                )}
                {!archived && selected.confirmation && (
                  <div>
                    <h3>Human confirmation</h3>
                    <p>{selected.confirmation.reason}</p>
                    <p className="muted">
                      Reviewed version {selected.confirmation.reviewed_version} · Confirmed version{' '}
                      {selected.confirmation.confirmed_version}
                      <br />
                      {selected.confirmation.actor_id} · {selected.confirmation.client_id}
                      <br />
                      {selected.confirmation.confirmed_at}
                    </p>
                    <p className="muted">
                      This records approval at that time. It does not guarantee that linked evidence
                      remains current.
                    </p>
                  </div>
                )}
                {!archived && selected.status === 'confirmed' && !selected.confirmation && (
                  <p className="muted">
                    This item has a confirmed status, but no human confirmation record is available
                    for this version.
                  </p>
                )}
                {!archived && selected.confirm_allowed === true && (
                  <details>
                    <summary>Confirm this version</summary>
                    <ConfirmContextItem
                      key={String(selected.id) + ':' + String(selected.version)}
                      item={selected}
                      initialKey={'context-confirm-' + crypto.randomUUID()}
                    />
                  </details>
                )}
                {archived && response.context_permissions?.write && (
                  <RestoreContextItem
                    key={String(selected.id) + ':' + String(selected.version)}
                    item={selected}
                    initialKey={'context-restore-' + crypto.randomUUID()}
                  />
                )}
                {!archived && response.context_permissions?.write && (
                  <>
                    <details>
                      <summary>Edit this item</summary>
                      <ContextItemEditor
                        key={String(selected.id) + ':' + String(selected.version)}
                        initial={selected}
                        initialKey={'context-update-' + crypto.randomUUID()}
                        restricted={response.context_permissions.restricted}
                      />
                    </details>
                    <details>
                      <summary>Archive this item</summary>
                      <ArchiveContextItem
                        key={String(selected.id) + ':' + String(selected.version)}
                        item={selected}
                        initialKey={'context-archive-' + crypto.randomUUID()}
                      />
                    </details>
                  </>
                )}
              </div>
            )}
          </Panel>
          <Panel title="Saved ContextPack" icon="context" className="context-detail">
            <div className="side-detail">
              {packMessage && <p role="status">{packMessage}</p>}
              {packNeedsReplacement && (
                <p className="muted">
                  Review the current project knowledge and prepare a fresh pack below. Existing
                  snapshots keep their original sources and cannot be refreshed in place.
                </p>
              )}
              {packError !== undefined && <PageError error={packError} />}
              {saved && (
                <>
                  <div className="pack-version">
                    Pack <strong>v{saved.version}</strong>
                    <Badge tone="cyan">Saved</Badge>
                  </div>
                  <div className="detail-grid">
                    <div>
                      <small>Included items</small>
                      <strong>{saved.pack.items.length}</strong>
                    </div>
                    <div>
                      <small>Estimated content tokens</small>
                      <strong>
                        {saved.used_tokens} / {saved.pack.budget_tokens}
                      </strong>
                    </div>
                    <div>
                      <small>Expires</small>
                      <strong>{saved.pack.expires_at}</strong>
                    </div>
                    <div>
                      <small>Excluded items</small>
                      <strong>{saved.pack.exclusions.length}</strong>
                    </div>
                  </div>
                  <p className="context-hash">
                    <small>Content hash</small>
                    <br />
                    <code>{saved.pack.pack_hash}</code>
                  </p>
                  <details>
                    <summary>Included content</summary>
                    {saved.pack.items.map((item) => (
                      <section key={item.id}>
                        <h3>
                          {item.layer} · {item.id}
                        </h3>
                        <Link
                          className="panel-link"
                          href={'/context?item=' + encodeURIComponent(item.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Review current item
                        </Link>
                        <pre className="context-content">{item.content}</pre>
                      </section>
                    ))}
                  </details>
                  <PackExclusions exclusions={saved.pack.exclusions} />
                  <details>
                    <summary>Exclusions and source references</summary>
                    <pre className="context-content">
                      {JSON.stringify(
                        { exclusions: saved.pack.exclusions, source_refs: saved.pack.source_refs },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                  <details>
                    <summary>View full pack JSON</summary>
                    <pre className="context-content">{JSON.stringify(saved, null, 2)}</pre>
                  </details>
                  <Link
                    className="panel-link"
                    href={'/context?pack=' + encodeURIComponent(saved.pack_id)}
                  >
                    Permalink to this pack
                  </Link>
                  <hr />
                </>
              )}
              <CompilePackForm
                key={packId ?? saved?.pack_id ?? 'new'}
                initialKey={'context-pack-' + crypto.randomUUID()}
                allowed={response.context_permissions?.compile === true}
              />
            </div>
          </Panel>
        </div>
      </>
    );
  } catch (error) {
    return (
      <>
        <div className="page-heading">
          <h1>Context</h1>
        </div>
        <PageError error={error} />
        <Link className="panel-link" href="/context">
          Return to the first page
        </Link>
      </>
    );
  }
}

function sourceUrl(item: ContextItem): string | undefined {
  const refs = Array.isArray(item.source_refs) ? item.source_refs : [];
  for (const value of [
    item.source_ref,
    ...refs.map((ref: unknown) =>
      ref && typeof ref === 'object' && 'uri' in ref ? ref.uri : undefined,
    ),
  ]) {
    if (typeof value !== 'string') continue;
    try {
      const url = new URL(value);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password)
        return url.href;
    } catch {
      /* Not every source reference is a URL. */
    }
  }
}
