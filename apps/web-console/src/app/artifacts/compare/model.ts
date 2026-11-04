import { isUlid, parseArtifactReadQuery } from '@planemem/contracts';
import type { ArtifactPageParams } from '../query';

export { parseArtifactComparisonQuery, compareArtifactMetadata } from '@planemem/contracts';
export type { ArtifactComparisonQuery } from '@planemem/contracts';

export interface ArtifactComparisonSelection {
  artifact_id?: string;
  from_version?: number;
  to_version?: number;
}

export function parseArtifactComparisonSelection(input: unknown): ArtifactComparisonSelection {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new TypeError('Choose a file and two saved versions.');
  const row = input as Record<string, unknown>;
  if (Object.keys(row).some((key) => !['artifact_id', 'from_version', 'to_version'].includes(key)))
    throw new TypeError('Use only the file ID and the two selected versions.');
  if (row.artifact_id === undefined) {
    if (row.from_version !== undefined || row.to_version !== undefined)
      throw new TypeError('A selected version requires a file ID.');
    return {};
  }
  const from = parseArtifactReadQuery({ artifact_id: row.artifact_id, version: row.from_version });
  const to = parseArtifactReadQuery({ artifact_id: row.artifact_id, version: row.to_version });
  if (from.version !== undefined && from.version === to.version)
    throw new TypeError('Choose two different saved versions.');
  return {
    artifact_id: from.artifact_id,
    ...(from.version === undefined ? {} : { from_version: from.version }),
    ...(to.version === undefined ? {} : { to_version: to.version }),
  };
}

export function parseArtifactComparisonPageQuery(params: ArtifactPageParams) {
  if (Object.keys(params).some((key) => !['artifact', 'from_version', 'to_version'].includes(key)))
    throw new TypeError('Use only a file ID, a base version and a comparison version.');
  if (params.artifact !== undefined && !isUlid(params.artifact))
    throw new TypeError('Enter one complete file ID.');
  const selection: ArtifactComparisonSelection =
    params.artifact === undefined ? {} : { artifact_id: params.artifact };
  for (const key of ['from_version', 'to_version'] as const) {
    const value = params[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !/^[1-9][0-9]{0,15}$/.test(value))
      throw new TypeError(
        'Versions must be single positive numbers without spaces or leading zeros.',
      );
    selection[key] = Number(value);
  }
  return parseArtifactComparisonSelection(selection);
}

export function artifactComparisonHref(input: ArtifactComparisonSelection = {}) {
  const query = parseArtifactComparisonSelection(input);
  const params = new URLSearchParams();
  if (query.artifact_id !== undefined) params.set('artifact', query.artifact_id);
  if (query.from_version !== undefined) params.set('from_version', String(query.from_version));
  if (query.to_version !== undefined) params.set('to_version', String(query.to_version));
  return '/artifacts/compare' + (params.size ? '?' + params.toString() : '');
}
