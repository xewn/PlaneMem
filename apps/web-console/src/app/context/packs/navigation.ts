import {
  isUlid,
  parseContextPackDirectoryQuery,
  type ContextPackDirectoryQuery,
} from '@planemem/contracts';
import type { ContextSearchParams } from '../navigation';

export interface PackDirectoryNavigation {
  query: ContextPackDirectoryQuery;
  base_pack_id?: string;
}
export function parsePackDirectoryParams(params: ContextSearchParams): PackDirectoryNavigation {
  if (
    Object.keys(params).some((key) => !['pack', 'limit', 'cursor', 'base'].includes(key)) ||
    Object.values(params).some((value) => value !== undefined && typeof value !== 'string')
  )
    throw new Error('Use one value per saved pack directory parameter.');
  if (
    params.limit !== undefined &&
    (typeof params.limit !== 'string' || !/^[1-9][0-9]{0,2}$/.test(params.limit))
  )
    throw new Error('Choose between 1 and 100 packs per page.');
  if (params.base !== undefined && !isUlid(params.base))
    throw new Error('Choose a valid base pack ID.');
  const query = parseContextPackDirectoryQuery({
    ...(params.pack === undefined || params.pack === '' ? {} : { pack_id: params.pack }),
    ...(params.limit === undefined ? {} : { limit: Number(params.limit) }),
    ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
  });
  return { query, ...(params.base === undefined ? {} : { base_pack_id: params.base as string }) };
}
export function packDirectoryHref(navigation: PackDirectoryNavigation): string {
  const normalized = parsePackDirectoryParams({
    ...(navigation.query.pack_id === undefined ? {} : { pack: navigation.query.pack_id }),
    limit: String(navigation.query.limit),
    ...(navigation.query.cursor === undefined ? {} : { cursor: navigation.query.cursor }),
    ...(navigation.base_pack_id === undefined ? {} : { base: navigation.base_pack_id }),
  });
  const params = new URLSearchParams({ limit: String(normalized.query.limit) });
  if (normalized.query.pack_id !== undefined) params.set('pack', normalized.query.pack_id);
  if (normalized.query.cursor !== undefined) params.set('cursor', normalized.query.cursor);
  if (normalized.base_pack_id !== undefined) params.set('base', normalized.base_pack_id);
  return '/context/packs?' + params.toString();
}
