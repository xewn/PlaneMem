import {
  isSyncIdentifier,
  isUlid,
  parseContextItemListQuery,
  type ContextItemListQuery,
} from '@planemem/contracts';
import { parseProjectSearchReturn } from '../search/navigation';

export type ContextSearchParams = Record<string, string | string[] | undefined>;
export interface ContextBrowseState {
  filters: ContextItemListQuery;
  item?: string;
  pack?: string;
  /** A validated project-search return for this exact selected item. */
  return_to?: string;
}
export interface ContextHistoryNavigation {
  item_id: string;
  before?: number;
  version?: number;
  return_href?: string;
}

const browseFields = [
  'q',
  'layer',
  'classification',
  'status',
  'type',
  'view',
  'cursor',
  'item',
  'pack',
  'return_to',
];
const maximumReturnLength = 16 * 1024;

function singleValues(params: ContextSearchParams, fields: readonly string[]) {
  if (
    Object.keys(params).some((key) => !fields.includes(key)) ||
    Object.values(params).some((value) => Array.isArray(value))
  )
    throw new Error('Use one value per known context page parameter.');
}
function itemId(value: unknown): string {
  if (!isSyncIdentifier(value) || value === '.' || value === '..')
    throw new Error('Choose a valid local context item ID.');
  return value;
}
function positive(value: string | string[] | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d{0,15}$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new Error('History version parameters must be positive integers.');
  return Number(value);
}

/** Invalid URL filters fail before reads instead of silently widening the requested directory. */
export function parseContextBrowseParams(params: ContextSearchParams): ContextBrowseState {
  singleValues(params, browseFields);
  if (params.view !== undefined && params.view !== 'active' && params.view !== 'archived')
    throw new Error('Choose active or archived context items.');
  if (
    params.return_to !== undefined &&
    Object.keys(params).some((key) => !['item', 'return_to'].includes(key))
  )
    throw new Error('Open the selected search result before changing the context browser filters.');
  const filters = parseContextItemListQuery({
    query: params.q ?? '',
    layer: params.layer ?? '',
    classification: params.classification ?? '',
    status: params.status ?? '',
    item_type: params.type ?? '',
    archived: params.view === 'archived',
    limit: 25,
    ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
  });
  const item = params.item === undefined ? undefined : itemId(params.item);
  if (params.pack !== undefined && !isUlid(params.pack))
    throw new Error('Choose a valid saved context pack ID.');
  const return_to =
    params.return_to === undefined
      ? undefined
      : parseProjectSearchReturn(params.return_to, {
          type: 'context_item',
          id: itemId(item),
        });
  const state: ContextBrowseState = {
    filters,
    ...(item === undefined ? {} : { item }),
    ...(params.pack === undefined ? {} : { pack: params.pack as string }),
    ...(return_to === undefined ? {} : { return_to }),
  };
  contextBrowseHref(state);
  return state;
}

/** Rebuild fixed internal URLs; return data never grants access or redirects automatically. */
export function contextBrowseHref(state: ContextBrowseState): string {
  const filters = parseContextItemListQuery(state.filters);
  if (filters.limit !== undefined && filters.limit !== 25)
    throw new Error('Use the context browser page size.');
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({
    q: filters.query,
    layer: filters.layer,
    classification: filters.classification,
    status: filters.status,
    type: filters.item_type,
    cursor: filters.cursor,
  }))
    if (value !== undefined) search.set(key, value);
  if (filters.archived) search.set('view', 'archived');
  if (state.item !== undefined) search.set('item', itemId(state.item));
  if (state.pack !== undefined) {
    if (!isUlid(state.pack)) throw new Error('Choose a valid saved context pack ID.');
    search.set('pack', state.pack);
  }
  if (state.return_to !== undefined) {
    if (Array.from(search.keys()).some((key) => key !== 'item'))
      throw new Error('Search returns must retain their original context selection.');
    search.set(
      'return_to',
      parseProjectSearchReturn(state.return_to, { type: 'context_item', id: itemId(state.item) }),
    );
  }
  const href = '/context' + (search.size ? '?' + search.toString() : '');
  if (href.length > maximumReturnLength)
    throw new Error('The context navigation address is too long.');
  return href;
}

function browseReturn(value: unknown, id: string): string {
  if (
    typeof value !== 'string' ||
    value.length > maximumReturnLength ||
    value.includes('#') ||
    (value !== '/context' && !value.startsWith('/context?'))
  )
    throw new Error('Return to a context results page in this application.');
  const search = new URLSearchParams(value === '/context' ? '' : value.slice('/context?'.length));
  const params: ContextSearchParams = Object.create(null) as ContextSearchParams;
  for (const [key, entry] of search) {
    if (Object.hasOwn(params, key)) throw new Error('Use one value per context return parameter.');
    params[key] = entry;
  }
  const state = parseContextBrowseParams(params);
  if (state.item !== undefined && state.item !== id)
    throw new Error('The history return must select the same context item.');
  return contextBrowseHref({ ...state, item: id });
}

export function parseContextHistoryParams(params: ContextSearchParams): ContextHistoryNavigation {
  singleValues(params, ['item', 'before', 'version', 'return_to']);
  const item_id = itemId(params.item);
  const before = positive(params.before);
  const version = positive(params.version);
  return {
    item_id,
    ...(before === undefined ? {} : { before }),
    ...(version === undefined ? {} : { version }),
    ...(params.return_to === undefined
      ? {}
      : { return_href: browseReturn(params.return_to, item_id) }),
  };
}

export function contextHistoryHref(navigation: ContextHistoryNavigation): string {
  const id = itemId(navigation.item_id);
  const search = new URLSearchParams({ item: id });
  for (const field of ['before', 'version'] as const) {
    const value = navigation[field];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error('Choose a positive history version.');
    search.set(field, String(value));
  }
  if (navigation.return_href !== undefined)
    search.set('return_to', browseReturn(navigation.return_href, id));
  return '/context/history?' + search.toString();
}
