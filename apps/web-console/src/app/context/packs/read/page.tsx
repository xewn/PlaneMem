import Link from 'next/link';
import { PageError } from '../../../../components/page-state';
import { Badge, Panel } from '../../../../components/ui';
import { readWorkbenchContextPack } from '../../../../lib/server-api';
import type { ContextSearchParams } from '../../navigation';
import { PackExclusions } from '../../pack-exclusions';
import { packComparisonHref } from '../compare/navigation';
import { packReadHref, parsePackReadParams, type PackReadNavigation } from './navigation';

export const dynamic = 'force-dynamic';

export default async function SavedPackReadPage({
  searchParams,
}: {
  searchParams: Promise<ContextSearchParams>;
}) {
  let navigation: PackReadNavigation;
  try {
    navigation = parsePackReadParams(await searchParams);
  } catch (error) {
    return (
      <>
        <h1>Read a saved pack</h1>
        <PageError error={error} />
        <Link className="panel-link" href="/context/packs/read" prefetch={false}>
          Choose a saved pack
        </Link>
        <Link className="panel-link" href="/context" prefetch={false}>
          Back to context
        </Link>
      </>
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Read a saved pack</h1>
          <p>Open saved knowledge, exclusions and sources by pack ID.</p>
        </div>
        <Link className="panel-link" href={navigation.return_href ?? '/context'} prefetch={false}>
          {navigation.return_href?.startsWith('/context/packs/compare')
            ? 'Back to comparison'
            : navigation.return_href?.startsWith('/context/packs')
              ? 'Back to saved packs'
              : 'Back to context'}
        </Link>
      </div>
      <Panel title="Choose a saved pack" icon="context">
        <div className="side-detail">
          <form
            action="/context/packs/read"
            method="get"
            className="artifact-lookup-form"
            key={JSON.stringify(navigation)}
          >
            <ReturnField navigation={navigation} />
            <label htmlFor="saved-pack-id">Saved pack ID</label>
            <input
              id="saved-pack-id"
              name="pack"
              type="text"
              required
              maxLength={26}
              pattern="[0-9A-HJKMNP-TV-Z]{26}"
              defaultValue={navigation.pack_id ?? ''}
            />
            <button type="submit" className="primary-button">
              Read this saved pack
            </button>
          </form>
          <form action="/context/packs/read" method="get">
            <ReturnField navigation={navigation} />
            <input type="hidden" name="latest" value="1" />
            <button type="submit" className="secondary-button">
              Read the latest visible pack
            </button>
          </form>
          <p className="muted">
            The current project and account determine access. Expired packs and packs whose sources
            changed remain unavailable. Latest is selected again on each read; use a fixed pack link
            to keep the same selection.
          </p>
          <Link className="panel-link" href="/context/packs" prefetch={false}>
            Browse saved packs
          </Link>
        </div>
      </Panel>
      {navigation.pack_id !== undefined || navigation.latest ? (
        <SavedPack navigation={navigation} />
      ) : (
        <p className="side-detail">Enter a pack ID or choose the latest visible pack.</p>
      )}
    </>
  );
}

function ReturnField({ navigation }: { navigation: PackReadNavigation }) {
  return navigation.return_href ? (
    <input type="hidden" name="return_to" value={navigation.return_href} />
  ) : null;
}

function Retry({ navigation }: { navigation: PackReadNavigation }) {
  const params = new URLSearchParams(packReadHref(navigation).split('?')[1]);
  return (
    <form action="/context/packs/read" method="get">
      {Array.from(params).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button className="secondary-button" type="submit">
        {navigation.latest ? 'Read latest again' : 'Retry this saved pack'}
      </button>
    </form>
  );
}

async function SavedPack({ navigation }: { navigation: PackReadNavigation }) {
  try {
    // The dedicated read does not require context directory or current-item reads to succeed.
    const response = await readWorkbenchContextPack(navigation.pack_id);
    const saved = response.data;
    const fixed = { pack_id: saved.pack_id, return_href: navigation.return_href };
    const comparisonReturn = navigation.return_href?.startsWith('/context/packs/compare')
      ? undefined
      : navigation.return_href;
    return (
      <>
        <Panel title={`Saved pack · version ${saved.version}`} icon="context">
          <div className="side-detail">
            <p className="context-hash">Pack ID: {saved.pack_id}</p>
            <div className="detail-grid">
              <div>
                <small>Saved</small>
                <strong>{saved.created_at}</strong>
              </div>
              <div>
                <small>Expires</small>
                <strong>{saved.pack.expires_at}</strong>
              </div>
              <div>
                <small>Included items</small>
                <strong>{saved.pack.items.length}</strong>
              </div>
              <div>
                <small>Excluded items</small>
                <strong>{saved.pack.exclusions.length}</strong>
              </div>
              <div>
                <small>Estimated content tokens</small>
                <strong>
                  {saved.used_tokens} / {saved.pack.budget_tokens}
                </strong>
              </div>
            </div>
            <p className="context-hash">
              <small>Content hash</small>
              <br />
              <code>{saved.pack.pack_hash}</code>
            </p>
            <p className="muted">
              This complete saved pack passed its read and content hash checks. Saved references do
              not prove external evidence is authentic or will remain available.
            </p>
            <nav className="heading-actions" aria-label="Saved pack actions">
              <Link className="panel-link" href={packReadHref(fixed)} prefetch={false}>
                Fixed link to this pack
              </Link>
              <Link
                className="panel-link"
                prefetch={false}
                href={packComparisonHref({
                  from_pack_id: saved.pack_id,
                  return_href: comparisonReturn,
                })}
              >
                Compare with another saved pack
              </Link>
            </nav>
            <Retry navigation={navigation} />
          </div>
        </Panel>
        <Panel title="Included saved knowledge" icon="context">
          <div className="side-detail">
            {saved.pack.items.length === 0 && <p>This pack contains no selected items.</p>}
            {saved.pack.items.map((item, index) => (
              <details key={item.id} className="side-detail">
                <summary>
                  <span className="context-hash">
                    {index + 1}. {item.layer} · {item.id}
                  </span>
                </summary>
                <Badge tone="neutral">{item.sensitivity}</Badge>
                <p>{item.confirmed ? 'Confirmed when saved' : 'Not confirmed when saved'}</p>
                <pre className="context-content" tabIndex={0} aria-label="Complete saved content">
                  {item.content}
                </pre>
                <details>
                  <summary>All saved item fields and sources</summary>
                  <pre className="context-content" tabIndex={0}>
                    {JSON.stringify(item, null, 2)}
                  </pre>
                </details>
              </details>
            ))}
          </div>
        </Panel>
        <Panel title="Exclusions and sources" icon="context">
          <div className="side-detail">
            <PackExclusions exclusions={saved.pack.exclusions} />
            <details>
              <summary>Complete saved source references</summary>
              <pre className="context-content" tabIndex={0}>
                {JSON.stringify(saved.pack.source_refs, null, 2)}
              </pre>
            </details>
            <details>
              <summary>Complete response and read information</summary>
              <pre className="context-content" tabIndex={0}>
                {JSON.stringify(response, null, 2)}
              </pre>
            </details>
          </div>
        </Panel>
      </>
    );
  } catch (error) {
    return (
      <>
        <PageError error={error} />
        <p className="side-detail">
          The complete saved pack could not be read. Keep this selection to retry, or choose a
          different pack above.
        </p>
        <Retry navigation={navigation} />
      </>
    );
  }
}
