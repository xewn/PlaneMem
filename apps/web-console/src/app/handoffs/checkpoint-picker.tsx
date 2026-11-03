import Link from 'next/link';
import {
  parseCheckpointRegistryQuery,
  type CheckpointRegistryQuery,
  type CheckpointRegistryRecord,
  type CheckpointRegistryScope,
  type SessionCommandIdentity,
} from '@planemem/contracts';
import { PageError } from '../../components/page-state';
import { queryWorkbench, WorkbenchApiError } from '../../lib/server-api';
import { CreateForm, type CheckpointOption } from './create-form';

export async function CheckpointPicker({
  queryText,
  checkpointId,
  cursor,
  pageParams,
  scope,
  identity,
  canWrite,
}: {
  queryText: string | string[] | undefined;
  checkpointId: string | string[] | undefined;
  cursor: string | string[] | undefined;
  pageParams: Record<string, string>;
  scope: CheckpointRegistryScope | undefined;
  identity: SessionCommandIdentity | undefined;
  canWrite: boolean;
}) {
  let query: CheckpointRegistryQuery | undefined;
  let options: CheckpointOption[] = [];
  let nextCursor: string | undefined;
  let readError: unknown;
  let unavailable = false;
  let selectionCanWrite = false;
  try {
    query = parseCheckpointRegistryQuery({
      query: queryText ?? '',
      limit: 25,
      ...(checkpointId === undefined || checkpointId === '' ? {} : { checkpoint_id: checkpointId }),
      ...(cursor === undefined ? {} : { cursor }),
    });
    const response = await queryWorkbench<CheckpointRegistryRecord[]>('checkpoints', { ...query });
    if (
      !scope ||
      !response.scope ||
      (['tenant_id', 'workspace_id', 'project_id'] as const).some(
        (field) => response.scope?.[field] !== scope[field],
      ) ||
      JSON.stringify(response.session_identity) !== JSON.stringify(identity)
    )
      throw new WorkbenchApiError(
        'Your project or identity changed. Reload before selecting a checkpoint.',
        response.trace_id,
      );
    selectionCanWrite = response.session_permissions?.write_sessions === true;
    options = response.data.map((row) => {
      const summary =
        row.summary_state === 'too-large'
          ? 'Summary omitted: directory limit'
          : row.summary_state === 'missing'
            ? 'No summary recorded'
            : row.summary?.trim()
              ? row.summary.slice(0, 240) + (row.summary.length > 240 ? '…' : '')
              : 'Empty summary';
      return {
        id: row.checkpoint_id,
        session: row.session_id,
        label: [row.session_id, 'revision ' + row.revision, row.checkpoint_id, summary].join(' · '),
      };
    });
    nextCursor = response.next_cursor;
  } catch (error) {
    unavailable = true;
    readError = error;
  }
  const baseParams = { ...pageParams, create: '1' };
  const filterParams = {
    ...baseParams,
    ...(query?.query ? { checkpointQuery: query.query } : {}),
    ...(query?.checkpoint_id ? { checkpoint: query.checkpoint_id } : {}),
  };
  return (
    <>
      <form
        action="/handoffs"
        method="get"
        className="side-detail"
        key={JSON.stringify([queryText, checkpointId])}
      >
        {Object.entries(baseParams).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label>
          Search saved checkpoints
          <input
            name="checkpointQuery"
            type="search"
            maxLength={500}
            defaultValue={typeof queryText === 'string' ? queryText : ''}
            placeholder="Checkpoint, session, revision or summary"
          />
        </label>
        <label>
          Exact checkpoint ID (optional)
          <input
            name="checkpoint"
            maxLength={26}
            pattern="[0-9A-HJKMNP-TV-Z]{26}"
            defaultValue={typeof checkpointId === 'string' ? checkpointId : ''}
          />
        </label>
        <button className="secondary-button">Find checkpoints</button>
        <Link
          className="panel-link"
          href={{ pathname: '/handoffs', query: baseParams }}
          prefetch={false}
        >
          Clear checkpoint filters
        </Link>
      </form>
      <nav className="heading-actions" aria-label="Checkpoint choice pages">
        <Link
          className="panel-link"
          href={{ pathname: '/handoffs', query: filterParams }}
          prefetch={false}
        >
          First checkpoint page
        </Link>
        {nextCursor && (
          <Link
            className="panel-link"
            prefetch={false}
            href={{
              pathname: '/handoffs',
              query: { ...filterParams, checkpointCursor: nextCursor },
            }}
          >
            Older checkpoints
          </Link>
        )}
      </nav>
      {unavailable ? (
        <PageError error={readError} />
      ) : (
        <p className="muted">
          {options.length} matching checkpoints on this page, newest saved first. This is not the
          project total.
        </p>
      )}
      <p className="muted">
        Changing filters or pages starts a fresh unsent draft. An original request already saved in
        this tab takes priority and keeps its checkpoint, recipient and request key. Review full
        notes before creating a handoff.
      </p>
      {!unavailable && canWrite && !selectionCanWrite && (
        <p>
          Session write access changed while loading these choices. Reload before preparing a new
          handoff; original requests can still be restored.
        </p>
      )}
      <CreateForm
        key={JSON.stringify([identity, queryText, checkpointId, cursor])}
        options={options}
        initialKey={crypto.randomUUID()}
        initialCheckpoint={query?.checkpoint_id}
        identity={identity}
        canWrite={canWrite}
        selectionCanWrite={selectionCanWrite}
        optionsUnavailable={unavailable}
        emptyMessage="No matching checkpoints on this page. Change the filters or return to the first checkpoint page; an original creation request can still be restored above."
      />
    </>
  );
}
