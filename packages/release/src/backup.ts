import { createHash } from 'node:crypto';

export interface BackupBundle {
  schema_version: 1;
  backup_id: string;
  manifest_version: string;
  files: Record<string, string>;
  hashes: Record<string, string>;
  created_at: string;
}

export function createBackup(input: {
  manifest_version: string;
  files: Record<string, string>;
}): BackupBundle {
  const backup_id = `backup_${createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 20)}`;
  const hashes = Object.fromEntries(
    Object.entries(input.files).map(([path, contents]) => [path, sha(contents)]),
  );
  return {
    schema_version: 1,
    backup_id,
    manifest_version: input.manifest_version,
    files: { ...input.files },
    hashes,
    created_at: new Date().toISOString(),
  };
}

export function restoreBackup(bundle: BackupBundle): BackupBundle & { verified: boolean } {
  const verified = Object.entries(bundle.files).every(
    ([path, contents]) => bundle.hashes[path] === sha(contents),
  );
  if (!verified) throw new Error('BACKUP_HASH_MISMATCH');
  return { ...bundle, files: { ...bundle.files }, hashes: { ...bundle.hashes }, verified };
}

function sha(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
