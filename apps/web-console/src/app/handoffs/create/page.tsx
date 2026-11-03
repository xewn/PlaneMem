import Link from 'next/link';
import { isUlid } from '@planemem/contracts';
import { PageError } from '../../../components/page-state';
import { Panel } from '../../../components/ui';
import { getWorkbenchCheckpoint, getWorkbenchSessionState } from '../../../lib/server-api';
import { CreateForm, type CheckpointOption } from '../create-form';

export default async function CreateHandoffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Hand off a saved checkpoint</h1>
          <p>Review this revision and choose its recipient before creating a handoff.</p>
        </div>
      </div>
      <nav className="heading-actions" aria-label="Related pages">
        <Link className="panel-link" href="/handoffs/recover" prefetch={false}>
          Recover original creation in this tab
        </Link>
        <Link className="panel-link" href="/sessions" target="_blank" rel="noreferrer">
          Sessions ↗
        </Link>
        <Link className="panel-link" href="/handoffs?create=1" target="_blank" rel="noreferrer">
          Browse checkpoints and creation recovery ↗
        </Link>
      </nav>
      <Creation searchParams={searchParams} />
    </>
  );
}

async function Creation({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const params = await searchParams;
    if (
      Object.keys(params).some((field) => !['session', 'checkpoint'].includes(field)) ||
      !isUlid(params.session) ||
      !isUlid(params.checkpoint)
    )
      throw new Error(
        'Open a saved checkpoint and choose its handoff action. Both record IDs are required.',
      );

    // Obtain verified identity independently of the checkpoint listing and all dashboard metrics.
    const session = await getWorkbenchSessionState(params.session);
    const options: CheckpointOption[] = [];
    let detail;
    let checkpointError;
    try {
      detail = await getWorkbenchCheckpoint(
        params.session,
        params.checkpoint,
        session.session_identity,
      );
      const checkpoint = detail.data.checkpoint;
      options.push({
        id: checkpoint.checkpoint_id,
        session: checkpoint.session_id,
        label: `${checkpoint.session_id} · checkpoint ${checkpoint.revision} · ${checkpoint.checkpoint_id}`,
      });
    } catch (error) {
      // Keep the identity-bound recovery form even when this checkpoint can no longer be read.
      checkpointError = error;
    }
    return (
      <>
        {detail ? (
          <Panel title={`Selected revision ${detail.data.checkpoint.revision}`} icon="context">
            <div className="side-detail">
              <p style={{ overflowWrap: 'anywhere' }}>Session · {params.session}</p>
              <p style={{ overflowWrap: 'anywhere' }}>Checkpoint · {params.checkpoint}</p>
              <p>
                Saved at <time dateTime={detail.data.created_at}>{detail.data.created_at}</time>
              </p>
              <Link
                className="panel-link"
                target="_blank"
                rel="noreferrer"
                href={{
                  pathname: '/sessions/checkpoint',
                  query: { session: params.session, checkpoint: params.checkpoint },
                }}
              >
                Review saved notes and references ↗
              </Link>
              <p className="muted">
                This selects a saved revision. Attached context is checked separately when a session
                is resumed.
              </p>
            </div>
          </Panel>
        ) : (
          <PageError error={checkpointError} />
        )}
        <Panel title="Create or recover a handoff" icon="handoffs">
          <div className="side-detail">
            <p>
              An unresolved creation already saved in this tab takes priority over this selection.
              Review the original checkpoint and recipient shown in the form before continuing.
            </p>
          </div>
          <CreateForm
            key={JSON.stringify(session.session_identity)}
            options={options}
            initialKey={crypto.randomUUID()}
            initialCheckpoint={params.checkpoint}
            identity={session.session_identity}
            canWrite={session.session_permissions?.write_sessions === true}
          />
        </Panel>
      </>
    );
  } catch (error) {
    return <PageError error={error} />;
  }
}
