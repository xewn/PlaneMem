import { isUlid, parseArtifactReadQuery, type ArtifactReadQuery } from '@planemem/contracts';

export type ArtifactPageParams = Record<string, string | string[] | undefined>;

export function parseArtifactPageQuery(params: ArtifactPageParams): ArtifactReadQuery | undefined {
  if (Object.keys(params).some((key) => !['artifact', 'version'].includes(key)))
    throw new Error('This page accepts only a file ID and an optional version.');
  if (params.artifact === undefined && params.version === undefined) return;
  if (!isUlid(params.artifact)) throw new Error('Enter one complete file ID to read its details.');
  if (
    params.version !== undefined &&
    (typeof params.version !== 'string' ||
      !/^[1-9][0-9]{0,15}$/.test(params.version) ||
      !Number.isSafeInteger(Number(params.version)))
  )
    throw new Error('Enter one positive version number without spaces or leading zeros.');
  return parseArtifactReadQuery({
    artifact_id: params.artifact,
    ...(params.version === undefined ? {} : { version: Number(params.version) }),
  });
}

export function artifactPageHref(artifactId: string, version?: number): string {
  const query = parseArtifactReadQuery({
    artifact_id: artifactId,
    ...(version === undefined ? {} : { version }),
  });
  return (
    '/artifacts?artifact=' +
    encodeURIComponent(query.artifact_id) +
    (query.version === undefined ? '' : '&version=' + query.version)
  );
}
