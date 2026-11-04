import { isUlid, syncJsonSnapshot } from '@planemem/contracts';
import { packDirectoryHref, parsePackDirectoryParams } from '../navigation';
import {
  contextBrowseHref,
  parseContextBrowseParams,
  type ContextSearchParams,
} from '../../navigation';

export interface PackComparisonNavigation {
  from_pack_id?: string;
  to_pack_id?: string;
  show?: 'changes';
  return_href?: string;
}

function returnHref(value: unknown): string {
  const directory =
    typeof value === 'string' &&
    (value === '/context/packs' || value.startsWith('/context/packs?'));
  const path = directory ? '/context/packs' : '/context';
  if (
    typeof value !== 'string' ||
    value.length > 16 * 1024 ||
    value.includes('#') ||
    (value !== path && !value.startsWith(path + '?'))
  )
    throw new Error('Return to a context page in this application.');
  const params: ContextSearchParams = Object.create(null) as ContextSearchParams;
  for (const [key, entry] of new URLSearchParams(value.slice(path.length))) {
    if (Object.hasOwn(params, key)) throw new Error('Use one value per context return parameter.');
    params[key] = entry;
  }
  return directory
    ? packDirectoryHref(parsePackDirectoryParams(params))
    : contextBrowseHref(parseContextBrowseParams(params));
}

/** Partial selections fill the form only; neither side silently selects latest. */
export function parsePackComparisonParams(params: ContextSearchParams): PackComparisonNavigation {
  if (
    Object.keys(params).some((key) => !['from', 'to', 'show', 'return_to'].includes(key)) ||
    Object.values(params).some((value) => value !== undefined && typeof value !== 'string')
  )
    throw new Error('Use one value per known saved pack comparison parameter.');
  syncJsonSnapshot(
    Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined)),
    24 * 1024,
  );
  for (const field of ['from', 'to'] as const)
    if (params[field] !== undefined && !isUlid(params[field]))
      throw new Error('Choose saved pack IDs in the original project.');
  if (params.show !== undefined && params.show !== 'all' && params.show !== 'changes')
    throw new Error('Choose all candidates or changes only.');
  return {
    ...(params.from === undefined ? {} : { from_pack_id: params.from as string }),
    ...(params.to === undefined ? {} : { to_pack_id: params.to as string }),
    ...(params.show === 'changes' ? { show: 'changes' as const } : {}),
    ...(params.return_to === undefined ? {} : { return_href: returnHref(params.return_to) }),
  };
}

export function packComparisonHref(navigation: PackComparisonNavigation): string {
  const input = {
    ...(navigation.from_pack_id === undefined ? {} : { from: navigation.from_pack_id }),
    ...(navigation.to_pack_id === undefined ? {} : { to: navigation.to_pack_id }),
    ...(navigation.show === undefined ? {} : { show: navigation.show }),
    ...(navigation.return_href === undefined ? {} : { return_to: navigation.return_href }),
  };
  const normalized = parsePackComparisonParams(input);
  const params = new URLSearchParams();
  if (normalized.from_pack_id !== undefined) params.set('from', normalized.from_pack_id);
  if (normalized.to_pack_id !== undefined) params.set('to', normalized.to_pack_id);
  if (normalized.show !== undefined) params.set('show', normalized.show);
  if (normalized.return_href !== undefined) params.set('return_to', normalized.return_href);
  return '/context/packs/compare' + (params.size ? '?' + params.toString() : '');
}
