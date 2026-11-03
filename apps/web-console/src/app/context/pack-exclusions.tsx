import Link from 'next/link';
import type { ContextPack } from '@planemem/contracts';

const explanations: Record<ContextPack['exclusions'][number]['reason'], string> = {
  source: 'The local source chain was invalid. Review the item and repair its references.',
  expired: 'The item had expired. Review its content and expiry before making it available again.',
  budget: 'The item did not fit the content budget. Review its priority or choose a larger budget.',
  policy: 'The item was excluded by policy. Inclusion requires an authorized policy decision.',
};

export function PackExclusions({ exclusions }: { exclusions: ContextPack['exclusions'] }) {
  if (!exclusions.length) return <p className="muted">No candidate items were excluded.</p>;
  return (
    <details>
      <summary>Why {exclusions.length} candidate items were excluded</summary>
      <p className="muted">
        These reasons describe this saved pack. Open an item in a new tab to review its current
        state. After making changes, prepare a fresh pack; this snapshot keeps its original content.
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Reason</th>
              <th>Next step</th>
            </tr>
          </thead>
          <tbody>
            {exclusions.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link
                    className="panel-link"
                    href={'/context?item=' + encodeURIComponent(item.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.id}
                  </Link>
                </td>
                <td>{item.reason}</td>
                <td>
                  {explanations[item.reason] ??
                    'Review the current item before preparing a fresh pack.'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
