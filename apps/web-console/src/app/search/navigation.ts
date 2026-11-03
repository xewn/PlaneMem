import {
  parseProjectSearchQuery,
  parseWorkItemProjectionQuery,
  type NormalizedProjectSearchQuery,
} from '@planemem/contracts';

export type ProjectSearchParams = Record<string, string | string[] | undefined>;
export interface SearchSelection {
  type: 'work_item' | 'context_item';
  id: string;
}
export interface ProjectSearchNavigation {
  text: string;
  type: NormalizedProjectSearchQuery['type'];
  mode: NormalizedProjectSearchQuery['mode'];
  inactive: boolean;
  query: NormalizedProjectSearchQuery | undefined;
  selection: SearchSelection | undefined;
}
const fields = ['q', 'type', 'mode', 'inactive', 'cursor', 'item', 'item_type'];
const maximumReturnLength = 16 * 1024;

/** The page, detail links and return paths share the same interpretation. */
export function parseProjectSearchParams(params: ProjectSearchParams): ProjectSearchNavigation {
  if (
    Object.keys(params).some((key) => !fields.includes(key)) ||
    Object.values(params).some((value) => value !== undefined && typeof value !== 'string')
  )
    throw new Error('Use one value per search filter.');
  const text = typeof params.q === 'string' ? params.q : '';
  if (text.length > 500 || /[\u0000\p{Cs}]/u.test(text))
    throw new Error('Search text must be at most 500 characters.');
  if (params.inactive !== undefined && params.inactive !== 'true')
    throw new Error('Invalid inactive context filter.');
  const parsed = parseProjectSearchQuery({
    query: text.trim() ? text : 'Empty search navigation',
    type: params.type ?? 'all',
    mode: params.mode ?? 'fts',
    include_inactive_context: params.inactive === 'true',
    limit: 20,
    ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
  });
  const query = text.trim() ? parsed : undefined;
  let selection: SearchSelection | undefined;
  if (params.item !== undefined || params.item_type !== undefined) {
    if (
      !query ||
      (params.item_type !== 'work_item' && params.item_type !== 'context_item') ||
      (parsed.type !== 'all' && params.item_type !== parsed.type)
    )
      throw new Error('Select a result type that matches the search.');
    selection = {
      type: params.item_type,
      id: parseWorkItemProjectionQuery({ item_id: params.item }).item_id,
    };
  }
  if (!query && params.cursor !== undefined)
    throw new Error('Enter a search query before continuing a page.');
  return {
    text,
    type: parsed.type,
    mode: parsed.mode,
    inactive: parsed.include_inactive_context,
    query,
    selection,
  };
}

/** null explicitly clears a cursor/selection; omitted options preserve it. */
export function projectSearchHref(
  state: ProjectSearchNavigation,
  options: {
    cursor?: string | null;
    selection?: SearchSelection | null;
  } = {},
): string {
  const cursor = options.cursor === undefined ? state.query?.cursor : options.cursor;
  const selected = options.selection === undefined ? state.selection : options.selection;
  const params: Record<string, string> = {
    q: state.query?.query ?? state.text,
    type: state.type,
    mode: state.mode,
    ...(state.inactive ? { inactive: 'true' } : {}),
    ...(cursor == null ? {} : { cursor }),
    ...(selected ? { item: selected.id, item_type: selected.type } : {}),
  };
  parseProjectSearchParams(params);
  const search = new URLSearchParams(params);
  const href = '/search?' + search.toString();
  if (href.length > maximumReturnLength) throw new Error('The search return query is too long.');
  return href;
}

export function projectSearchResultHref(
  state: ProjectSearchNavigation,
  selected: SearchSelection,
): string {
  const returnHref = projectSearchHref(state, { selection: selected });
  const destination = selected.type === 'work_item' ? '/work-items/detail' : '/context';
  return (
    destination + '?' + new URLSearchParams({ item: selected.id, return_to: returnHref }).toString()
  );
}

/** Only the fixed search page is accepted, with the exact selected record bound to this detail. */
export function parseProjectSearchReturn(value: unknown, selected: SearchSelection): string {
  if (
    typeof value !== 'string' ||
    value.length > maximumReturnLength ||
    !value.startsWith('/search?') ||
    /[#\\\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error('Return to the original search results in this application.');
  const params: ProjectSearchParams = Object.create(null) as ProjectSearchParams;
  for (const [key, input] of new URLSearchParams(value.slice('/search?'.length))) {
    if (!fields.includes(key) || Object.hasOwn(params, key))
      throw new Error('Use one value per search return filter.');
    params[key] = input;
  }
  const state = parseProjectSearchParams(params);
  if (
    !state.query ||
    !state.selection ||
    state.selection.id !== selected.id ||
    state.selection.type !== selected.type
  )
    throw new Error('The search return selection must match this detail.');
  return projectSearchHref(state);
}
