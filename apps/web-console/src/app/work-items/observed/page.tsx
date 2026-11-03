import Link from 'next/link';
import type { ReactNode } from 'react';
import { parseObservedRecordId, parseObservedWorkItemListQuery } from '@planemem/contracts';
import {
  ObservedContextView,
  ObservedReadError,
  ObservedSnapshotView,
} from '../../../components/observed-snapshot';
import { EmptyState, Panel } from '../../../components/ui';
import { getWorkbenchObservedContext, getWorkbenchObservedWorkItem } from '../../../lib/server-api';

export default async function ObservedWorkItemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  let content: ReactNode;
  let directoryHref = '/work-items/observed/list';
  let directoryFields: Record<string, string> = {};
  try {
    if (
      Object.keys(params).some(
        (key) => !['item', 'with_context', 'list_query', 'list_state', 'list_cursor'].includes(key),
      ) ||
      (params.with_context !== undefined && params.with_context !== '1')
    ) {
      throw new Error('Use one item ID and an optional context selection.');
    }
    if (['list_query', 'list_state', 'list_cursor'].some((key) => params[key] !== undefined)) {
      const directory = parseObservedWorkItemListQuery({
        query: params.list_query ?? '',
        state: params.list_state ?? 'active',
        limit: 25,
        ...(params.list_cursor === undefined ? {} : { cursor: params.list_cursor }),
      });
      const search = new URLSearchParams({ state: directory.state });
      if (directory.query) search.set('q', directory.query);
      if (directory.cursor) search.set('cursor', directory.cursor);
      directoryHref += '?' + search;
      directoryFields = {
        list_query: directory.query,
        list_state: directory.state,
        ...(directory.cursor ? { list_cursor: directory.cursor } : {}),
      };
    }
    if (params.item === undefined && params.with_context === undefined) {
      content = (
        <Panel title="Find an observation" icon="work">
          <EmptyState
            title="Enter a Plane work item ID"
            message="Use its external ID or observation aggregate ID within the current project."
          />
        </Panel>
      );
    } else {
      const id = parseObservedRecordId(params.item);
      if (params.with_context === '1') {
        const result = await getWorkbenchObservedContext(id);
        content = (
          <>
            <ObservedSnapshotView snapshot={result.data.work_item} trace={result.trace_id} />
            <ObservedContextView context={result.data.context_pack} />
          </>
        );
      } else {
        const result = await getWorkbenchObservedWorkItem(id);
        content = <ObservedSnapshotView snapshot={result.data} trace={result.trace_id} />;
      }
    }
  } catch (error) {
    content = <ObservedReadError error={error} />;
  }
  const inputId = typeof params.item === 'string' ? params.item : '';
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Plane work item observation</h1>
          <p>Find a saved observation in the current project.</p>
        </div>
        <div className="heading-actions">
          <Link className="panel-link" href={directoryHref} prefetch={false}>
            {Object.keys(directoryFields).length ? 'Back to results' : 'Browse observations'}
          </Link>
          <Link className="panel-link" href="/work-items">
            Back to work items
          </Link>
        </div>
      </div>
      <p className="muted">
        Local work item records and Plane observations are stored separately. A local display
        reference may not match a Plane external ID.
      </p>
      <form
        className="filters"
        action="/work-items/observed"
        method="get"
        key={JSON.stringify([inputId, params.with_context, directoryFields])}
      >
        {Object.entries(directoryFields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label className="filter-input">
          <span>Plane work item ID</span>
          <input
            name="item"
            defaultValue={inputId}
            required
            maxLength={255}
            placeholder="External or aggregate ID"
          />
        </label>
        <label>
          <input
            type="checkbox"
            name="with_context"
            value="1"
            defaultChecked={params.with_context === '1'}
            aria-describedby="observed-context-help"
          />{' '}
          Include context
        </label>
        <button className="secondary-button" type="submit">
          Read saved observation
        </button>
        <Link
          className="panel-link"
          href={
            Object.keys(directoryFields).length
              ? '/work-items/observed?' + new URLSearchParams(directoryFields)
              : '/work-items/observed'
          }
          prefetch={false}
        >
          Clear
        </Link>
      </form>
      <p id="observed-context-help" className="muted">
        Include context requests a summary and may query external memory using this work item's
        saved title. Leave it unchecked to read only the observation. If context is unavailable,
        uncheck it and retry.
      </p>
      {content}
    </>
  );
}
