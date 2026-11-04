import { isUlid, syncJsonSnapshot } from '@planemem/contracts';
import {
  contextBrowseHref,
  parseContextBrowseParams,
  type ContextSearchParams,
} from '../../navigation';
import { packComparisonHref, parsePackComparisonParams } from '../compare/navigation';
import { packDirectoryHref, parsePackDirectoryParams } from '../navigation';

export interface PackReadNavigation {
  pack_id?: string;
  latest?: true;
  return_href?: string;
}

function returnHref(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64 * 1024 || value.includes('#'))
    throw new Error('Choose a context page in this application as the return destination.');
  const comparison =
    value === '/context/packs/compare' || value.startsWith('/context/packs/compare?');
  const directory = value === '/context/packs' || value.startsWith('/context/packs?');
  const path = comparison ? '/context/packs/compare' : directory ? '/context/packs' : '/context';
  if (value !== path && !value.startsWith(path + '?'))
    throw new Error('Return to a context browser or saved pack comparison in this application.');
  const params: ContextSearchParams = Object.create(null) as ContextSearchParams;
  for (const [key, entry] of new URLSearchParams(value.slice(path.length))) {
    if (Object.hasOwn(params, key)) throw new Error('Use one value per return parameter.');
    params[key] = entry;
  }
  // Comparison returns may contain one validated directory return; read-page returns cannot nest.
  return comparison
    ? packComparisonHref(parsePackComparisonParams(params))
    : directory
      ? packDirectoryHref(parsePackDirectoryParams(params))
      : contextBrowseHref(parseContextBrowseParams(params));
}

/** An empty page is a lookup form. Latest is an explicit action, never an invalid-ID fallback. */
export function parsePackReadParams(params: ContextSearchParams): PackReadNavigation {
  if (
    Object.keys(params).some((key) => !['pack', 'latest', 'return_to'].includes(key)) ||
    Object.values(params).some((value) => value !== undefined && typeof value !== 'string')
  )
    throw new Error('Use one value per known saved pack parameter.');
  syncJsonSnapshot(
    Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined)),
    96 * 1024,
  );
  if (params.pack !== undefined && !isUlid(params.pack))
    throw new Error('Enter a complete saved pack ID.');
  if (params.latest !== undefined && (params.latest !== '1' || params.pack !== undefined))
    throw new Error('Choose a saved pack ID or explicitly read latest.');
  return {
    ...(params.pack === undefined ? {} : { pack_id: params.pack as string }),
    ...(params.latest === '1' ? { latest: true as const } : {}),
    ...(params.return_to === undefined ? {} : { return_href: returnHref(params.return_to) }),
  };
}

export function packReadHref(navigation: PackReadNavigation): string {
  const normalized = parsePackReadParams({
    ...(navigation.pack_id === undefined ? {} : { pack: navigation.pack_id }),
    ...(navigation.latest === undefined ? {} : { latest: '1' }),
    ...(navigation.return_href === undefined ? {} : { return_to: navigation.return_href }),
  });
  const params = new URLSearchParams();
  if (normalized.pack_id !== undefined) params.set('pack', normalized.pack_id);
  if (normalized.latest) params.set('latest', '1');
  if (normalized.return_href !== undefined) params.set('return_to', normalized.return_href);
  return '/context/packs/read' + (params.size ? '?' + params.toString() : '');
}
