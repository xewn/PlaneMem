import { Icon } from '../../components/icons';
import { PageError, numberValue, textValue, toneFor } from '../../components/page-state';
import { Badge, Panel, Progress } from '../../components/ui';
import { queryWorkbench } from '../../lib/server-api';

type ContextItem = Record<string, unknown>;
const layers = [
  ['L0', 'Project Brief', 'cyan'],
  ['L1', 'Current Work State', 'green'],
  ['L2', 'Confirmed Facts', 'yellow'],
  ['L3', 'Recent Activity', 'blue'],
  ['L4', 'On-demand Retrieval', 'purple'],
] as const;

export default async function ContextPage() {
  try {
    const response = await queryWorkbench<ContextItem[]>('context');
    const items = response.data ?? [];
    const selected = items[0];
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Context</h1>
            <p>
              Project facts, memory, source references and ContextPack layers compiled for AI
              clients.
            </p>
          </div>
          <div className="heading-actions">
            <Badge tone="green">Live sync</Badge>
          </div>
        </div>
        <div className="layer-grid">
          {layers.map(([id, label, tone]) => {
            const layerItems = items.filter((item) => item.layer === id);
            const count = layerItems.length;
            const confidence = layerItems.length
              ? Math.round(
                  (layerItems.reduce((sum, item) => sum + numberValue(item.confidence), 0) /
                    layerItems.length) *
                    100,
                )
              : 0;
            const confirmed = layerItems.filter((item) => String(item.status) === 'confirmed').length;
            return (
              <section className={`panel layer-card ${tone}`} key={id}>
                <Badge tone={tone}>{id}</Badge>
                <h3>{label}</h3>
                <div className="layer-stat">{count}</div>
                <small>items · confidence {confidence}% · {confirmed} confirmed</small>
                <Progress value={confidence} tone={tone} />
              </section>
            );
          })}
        </div>
        <div className="context-layout">
          <Panel title={`All Context Items (${items.length})`} icon="context">
            <div className="filters">
              <div className="filter-input">
                <Icon name="search" />
                Search context items
              </div>
              <button className="filter-chip">
                Type <Icon name="chevron" />
              </button>
              <button className="filter-chip">
                Layer <Icon name="chevron" />
              </button>
              <button className="filter-chip">
                Classification <Icon name="chevron" />
              </button>
              <button className="filter-chip">
                Status <Icon name="chevron" />
              </button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Layer</th>
                    <th>Source ref</th>
                    <th>Classification</th>
                    <th>Confidence</th>
                    <th>Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={String(item.id)}>
                      <td>
                        <div className="table-title">
                          <span className="check-box" /> <strong>{textValue(item.title)}</strong>
                        </div>
                      </td>
                      <td>{textValue(item.item_type)}</td>
                      <td>
                        <Badge tone={toneFor(item.layer)}>{textValue(item.layer)}</Badge>
                      </td>
                      <td className="muted">{textValue(item.source_ref)}</td>
                      <td>
                        <Badge tone={toneFor(item.status)}>{textValue(item.status)}</Badge>
                      </td>
                      <td>{numberValue(item.confidence).toFixed(2)}</td>
                      <td>{textValue(item.priority)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length === 0 ? (
                <div className="empty-state">
                  <h3>No context items</h3>
                  <p>Context rows will appear after the ContextPack projection is populated.</p>
                </div>
              ) : null}
            </div>
          </Panel>
          <Panel title="ContextPack" icon="context" className="context-detail">
            <div className="side-detail">
              <div className="pack-version">
                Pack <strong>latest</strong>
                <Badge tone="green">Database</Badge>
              </div>
              <div className="detail-grid">
                <div>
                  <small>Items</small>
                  <strong>{items.length}</strong>
                </div>
                <div>
                  <small>Scope</small>
                  <strong>L0–L4</strong>
                </div>
                <div>
                  <small>Trace</small>
                  <strong>{response.trace_id.slice(0, 16)}…</strong>
                </div>
                <div>
                  <small>Source refs</small>
                  <strong>{response.source_refs.length}</strong>
                </div>
              </div>
              <button className="primary-button" style={{ width: '100%', marginTop: 22 }}>
                Compile ContextPack
              </button>
              <hr />
              {selected ? (
                <>
                  <h2>{textValue(selected.title)}</h2>
                  <p className="muted">{textValue(selected.source_ref)}</p>
                  <div className="source-line">
                    <span>Classification</span>
                    <Badge tone={toneFor(selected.status)}>{textValue(selected.status)}</Badge>
                  </div>
                  <div className="source-line">
                    <span>Layer / type</span>
                    <strong>{textValue(selected.layer)} · {textValue(selected.item_type)}</strong>
                  </div>
                  <div className="source-line">
                    <span>Confidence</span>
                    <strong>{numberValue(selected.confidence).toFixed(2)}</strong>
                  </div>
                  <div className="source-line">
                    <span>Priority</span>
                    <strong>{textValue(selected.priority)}</strong>
                  </div>
                  <div className="source-line">
                    <span>Expires</span>
                    <small>{textValue(selected.expires_at)}</small>
                  </div>
                  <div className="heading-actions" style={{ marginTop: 18 }}>
                    <button className="secondary-button">
                      <Icon name="external" />
                      Open source
                    </button>
                    <button className="secondary-button">Render JSON</button>
                  </div>
                </>
              ) : null}
            </div>
          </Panel>
        </div>
      </>
    );
  } catch (error) {
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Context</h1>
            <p>
              Project facts, memory, source references and ContextPack layers compiled for AI
              clients.
            </p>
          </div>
        </div>
        <PageError error={error} />
      </>
    );
  }
}
