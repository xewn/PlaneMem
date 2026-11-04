import {
  isUlid,
  parseArtifactVersionsQuery,
  type ArtifactVersionsQuery,
} from '@planemem/contracts';
import type { ArtifactPageParams } from '../query';

export function parseArtifactVersionsPageQuery(
  params: ArtifactPageParams,
): ArtifactVersionsQuery | undefined {
  if (
    Object.keys(params).some(
      (key) => !['artifact', 'limit', 'at_version', 'before_version'].includes(key),
    )
  )
    throw new Error('Choose a file ID and valid history page settings.');
  if (Object.values(params).every((value) => value === undefined)) return;
  if (!isUlid(params.artifact))
    throw new Error('Enter one complete file ID to browse its history.');
  const query: ArtifactVersionsQuery = { artifact_id: params.artifact };
  for (const key of ['limit', 'at_version', 'before_version'] as const) {
    const value = params[key];
    if (value === undefined) continue;
    if (
      typeof value !== 'string' ||
      !/^[1-9][0-9]{0,15}$/.test(value) ||
      !Number.isSafeInteger(Number(value))
    )
      throw new Error(
        'Page settings must be single positive numbers without spaces or leading zeros.',
      );
    query[key] = Number(value);
  }
  try {
    return parseArtifactVersionsQuery(query);
  } catch {
    throw new Error(
      'Choose 1–20 versions per page. An older-page position needs its original version ceiling.',
    );
  }
}

export function artifactVersionsPageHref(input: ArtifactVersionsQuery): string {
  const query = parseArtifactVersionsQuery(input);
  const params = new URLSearchParams({ artifact: query.artifact_id, limit: String(query.limit) });
  if (query.at_version !== undefined) params.set('at_version', String(query.at_version));
  if (query.before_version !== undefined)
    params.set('before_version', String(query.before_version));
  return '/artifacts/versions?' + params.toString();
}
