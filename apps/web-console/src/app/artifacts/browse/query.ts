import { parseArtifactRegistryQuery, type ArtifactRegistryQuery } from '@planemem/contracts';
import type { ArtifactPageParams } from '../query';

export function parseArtifactRegistryPageQuery(
  params: ArtifactPageParams,
): ArtifactRegistryQuery & { limit: number } {
  if (
    Object.keys(params).some((key) => !['query', 'classification', 'limit', 'cursor'].includes(key))
  )
    throw new Error('This directory accepts only a file name, classification and page settings.');
  for (const value of Object.values(params))
    if (value !== undefined && typeof value !== 'string')
      throw new Error('Use a single value for each directory filter and page setting.');
  if (
    params.limit !== undefined &&
    (typeof params.limit !== 'string' ||
      !/^[1-9][0-9]{0,15}$/.test(params.limit) ||
      !Number.isSafeInteger(Number(params.limit)))
  )
    throw new Error('Choose 1–20 files per page without spaces or leading zeros.');
  try {
    return parseArtifactRegistryQuery({
      ...(params.query === undefined ? {} : { query: params.query }),
      ...(params.classification === undefined || params.classification === ''
        ? {}
        : { classification: params.classification }),
      ...(params.limit === undefined ? {} : { limit: Number(params.limit) }),
      ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
    });
  } catch {
    throw new Error(
      'Check the file name, classification and page settings, then use Search files to start from the first page.',
    );
  }
}

export function artifactRegistryPageHref(input: ArtifactRegistryQuery): string {
  const query = parseArtifactRegistryQuery(input);
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.query !== undefined) params.set('query', query.query);
  if (query.classification !== undefined) params.set('classification', query.classification);
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  return '/artifacts/browse?' + params.toString();
}
