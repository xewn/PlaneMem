import Link from 'next/link';
import { isUlid, checkpointNoteFields, type SourceRef } from '@planemem/contracts';
import { PageError } from '../../../components/page-state';
import { Panel } from '../../../components/ui';
import { getWorkbenchCheckpoint } from '../../../lib/server-api';
import { CheckpointLookup } from '../checkpoint-lookup';

const labels = {
  completed: 'Completed',
  in_progress: 'In progress',
  next_actions: 'Next actions',
  decisions: 'Decisions',
  risks: 'Risks',
  open_questions: 'Open questions',
};

export default async function CheckpointPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let lookupSession: string | undefined;
  try {
    const params = await searchParams;
    if (isUlid(params.session)) lookupSession = params.session;
    if (
      Object.keys(params).some((key) => !['session', 'checkpoint'].includes(key)) ||
      !isUlid(params.session) ||
      !isUlid(params.checkpoint)
    )
      throw new Error('Select a session and checkpoint to read the saved details.');
    const result = await getWorkbenchCheckpoint(params.session, params.checkpoint);
    const { checkpoint, created_at } = result.data;
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>Checkpoint details</h1>
            <p>Review the notes and references saved in this revision.</p>
          </div>
        </div>
        <nav className="heading-actions" aria-label="Related records in new tabs">
          <Link
            className="panel-link"
            target="_blank"
            rel="noreferrer"
            href={{ pathname: '/sessions/detail', query: { session: checkpoint.session_id } }}
          >
            Session state and recovery ↗
          </Link>
          <Link
            className="panel-link"
            target="_blank"
            rel="noreferrer"
            href={{ pathname: '/sessions/history', query: { session: checkpoint.session_id } }}
          >
            Checkpoint history ↗
          </Link>
          <Link
            className="panel-link"
            target="_blank"
            rel="noreferrer"
            href={{
              pathname: '/handoffs/create',
              query: { session: checkpoint.session_id, checkpoint: checkpoint.checkpoint_id },
            }}
          >
            Prepare handoff ↗
          </Link>
        </nav>
        <Panel title={`Saved revision ${checkpoint.revision}`} icon="sessions">
          <div className="side-detail">
            <p>
              This historical record does not confirm a particular request key or show the session’s
              current progress.
            </p>
            <dl className="detail-grid checkpoint-detail-meta">
              <div>
                <dt>Checkpoint</dt>
                <dd>{checkpoint.checkpoint_id}</dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>{checkpoint.session_id}</dd>
              </div>
              <div>
                <dt>Saved at</dt>
                <dd>
                  <time dateTime={created_at}>{created_at}</time>
                </dd>
              </div>
              <div>
                <dt>Revision</dt>
                <dd>{checkpoint.revision}</dd>
              </div>
            </dl>
            {checkpointNoteFields.map((field) => (
              <section key={field} aria-labelledby={`notes-${field}`}>
                <h2 id={`notes-${field}`} className="detail-section-title">
                  {labels[field]}
                </h2>
                {checkpoint[field].length ? (
                  <ul>
                    {checkpoint[field].map((note, index) => (
                      <li key={index} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        {note === '' ? <em>Empty saved note</em> : note}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No notes saved in this category.</p>
                )}
              </section>
            ))}
          </div>
        </Panel>
        <Panel title="Saved references" icon="database">
          <div className="side-detail">
            <p>Reference availability and context validity were not checked by this read.</p>
            {checkpoint.context_pack_id ? (
              <>
                <h2 className="detail-section-title">Context pack</h2>
                <p>
                  <code>{checkpoint.context_pack_id}</code>
                </p>
                <Link
                  className="panel-link"
                  target="_blank"
                  rel="noreferrer"
                  href={{ pathname: '/context', query: { pack: checkpoint.context_pack_id } }}
                >
                  Read saved context pack ↗
                </Link>
                <p className="muted">
                  Opening the pack checks its current access and validity separately.
                </p>
              </>
            ) : checkpoint.context_pack_hash ? (
              <p>Legacy context reference: no saved pack ID was recorded.</p>
            ) : (
              <p>No context pack was attached.</p>
            )}
            {checkpoint.context_pack_hash && (
              <p style={{ overflowWrap: 'anywhere' }}>
                Saved context hash · <code>{checkpoint.context_pack_hash}</code>
              </p>
            )}
            {checkpoint.memory_ref && (
              <>
                <h2 className="detail-section-title">Memory reference</h2>
                <p style={{ overflowWrap: 'anywhere' }}>
                  {checkpoint.memory_ref.page_ref} · revision {checkpoint.memory_ref.revision}
                </p>
                <p style={{ overflowWrap: 'anywhere' }}>
                  Saved memory hash · <code>{checkpoint.memory_ref.hash}</code>
                </p>
                <p className="muted">
                  This page displays the saved reference; it has not fetched memory content.
                </p>
              </>
            )}
            <h2 className="detail-section-title">Recorded sources</h2>
            <Sources refs={checkpoint.source_refs} />
            <dl>
              <dt>Saved state hash</dt>
              <dd style={{ overflowWrap: 'anywhere' }}>{checkpoint.state_hash}</dd>
              <dt>Record trace</dt>
              <dd style={{ overflowWrap: 'anywhere' }}>{checkpoint.trace_id}</dd>
              <dt>Read trace</dt>
              <dd style={{ overflowWrap: 'anywhere' }}>{result.trace_id}</dd>
            </dl>
          </div>
        </Panel>
      </>
    );
  } catch (error) {
    return (
      <>
        <div className="page-heading">
          <h1>Checkpoint details</h1>
        </div>
        <PageError error={error} />
        <CheckpointLookup session={lookupSession} />
      </>
    );
  }
}

function Sources({ refs }: { refs: SourceRef[] }) {
  return (
    <ul>
      {refs.map((source, index) => (
        <li key={index} style={{ overflowWrap: 'anywhere' }}>
          <code>
            {source.type}: {source.id}
          </code>
          {source.revision !== undefined && <> · revision {source.revision}</>}
          {source.uri && <p>{source.uri}</p>}
        </li>
      ))}
    </ul>
  );
}
