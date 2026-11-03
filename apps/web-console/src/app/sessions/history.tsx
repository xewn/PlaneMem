import Link from 'next/link';
import { checkpointNoteFields } from '@planemem/contracts';
import { PageError } from '../../components/page-state';
import { getWorkbenchCheckpointHistory } from '../../lib/server-api';
import { CheckpointLookup } from './checkpoint-lookup';

export async function CheckpointHistory({
  session,
  before,
  canWrite,
  standalone = false,
}: {
  session: string;
  before?: number;
  canWrite?: boolean;
  standalone?: boolean;
}) {
  try {
    const result = await getWorkbenchCheckpointHistory(session, before);
    const mayPrepare = canWrite !== false && result.session_permissions?.write_sessions === true;
    const navigation = standalone ? {} : { target: '_blank', rel: 'noreferrer' };
    return (
      <section aria-label="Checkpoint history">
        <p className="muted">
          {result.data.length} revisions on this page · Read trace {result.trace_id}. History is
          read separately from current session state and does not confirm an earlier save request.
        </p>
        {result.data.map((row) => (
          <details key={row.checkpoint_id}>
            <summary>
              Revision {row.revision} · <time dateTime={row.created_at}>{row.created_at}</time>
            </summary>
            <Link
              className="panel-link"
              target="_blank"
              rel="noreferrer"
              prefetch={false}
              href={{
                pathname: '/sessions/checkpoint',
                query: { session, checkpoint: row.checkpoint_id },
              }}
            >
              Open checkpoint details ↗
            </Link>
            {checkpointNoteFields.map(
              (name) =>
                row[name].length > 0 && (
                  <div key={name}>
                    <h4>{name.replaceAll('_', ' ')}</h4>
                    <ul>
                      {row[name].map((note, index) => (
                        <li
                          key={index}
                          style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                        >
                          {note === '' ? <em>Empty saved note</em> : note}
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
            )}
            <p className="muted">Record trace · {row.trace_id}</p>
            {row.context_pack_id ? (
              <p>
                <Link
                  className="panel-link"
                  href={{ pathname: '/context', query: { pack: row.context_pack_id } }}
                  target="_blank"
                  rel="noreferrer"
                  prefetch={false}
                >
                  Open saved context pack ↗
                </Link>
                <small>
                  {' '}
                  · Checked again on resume; this history does not establish current validity.
                </small>
              </p>
            ) : row.context_pack_hash ? (
              <p className="muted">Legacy context reference · not verified against a saved pack.</p>
            ) : null}
            {mayPrepare && (
              <Link
                className="panel-link"
                target="_blank"
                rel="noreferrer"
                prefetch={false}
                href={{
                  pathname: '/handoffs/create',
                  query: { session, checkpoint: row.checkpoint_id },
                }}
              >
                Hand off this revision ↗
              </Link>
            )}
          </details>
        ))}
        {!result.data.length && (
          <p>
            {before === undefined
              ? 'No checkpoints recorded for this session.'
              : 'No checkpoints older than this revision cursor.'}
          </p>
        )}
        <div className="heading-actions">
          {before !== undefined && (
            <Link
              className="panel-link"
              {...navigation}
              prefetch={false}
              href={{ pathname: '/sessions/history', query: { session } }}
            >
              Latest revisions{standalone ? '' : ' ↗'}
            </Link>
          )}
          {result.next_before_revision !== undefined && (
            <Link
              className="panel-link"
              {...navigation}
              prefetch={false}
              href={{
                pathname: '/sessions/history',
                query: { session, before: result.next_before_revision },
              }}
            >
              Older revisions{standalone ? '' : ' ↗'}
            </Link>
          )}
        </div>
      </section>
    );
  } catch (error) {
    return (
      <>
        <PageError error={error} />
        <CheckpointLookup session={session} />
      </>
    );
  }
}
