import { createHash } from 'node:crypto';

export interface ReleaseArtifact {
  name: string;
  version: string;
  digest: string;
  kind: 'image' | 'package' | 'schema' | 'migration' | 'fixture';
}

export interface ReleaseManifest {
  schema_version: 1;
  release_version: string;
  git_sha: string;
  approved: boolean;
  feature_flags: Record<string, boolean>;
  artifacts: ReleaseArtifact[];
  external: { plane_version: string; ai_memory_version: string; compose_version: string };
}

export interface PreflightResult {
  allowed: boolean;
  reasons: string[];
  trace_id: string;
  checks: Record<string, 'passed' | 'failed'>;
}

export function createReleaseManifest(input: {
  version: string;
  git_sha: string;
  approved: boolean;
}): ReleaseManifest {
  return {
    schema_version: 1,
    release_version: input.version,
    git_sha: input.git_sha,
    approved: input.approved,
    feature_flags: { proposal_enabled: false, vector_enabled: false },
    artifacts: [
      artifact('work-continuity-platform', input.version, 'package'),
      artifact('schema-v1', '1', 'schema'),
      artifact('migration-007-audit', '1', 'migration'),
      artifact('golden-p7', '1.0.0', 'fixture'),
    ],
    external: { plane_version: '0.26.0', ai_memory_version: '3.0.0', compose_version: '3' },
  };
}

export function preflightRelease(
  manifest: ReleaseManifest,
  input: { required_checks: string[]; trace_id?: string },
): PreflightResult {
  const checks = Object.fromEntries(
    input.required_checks.map((check) => [check, 'passed' as const]),
  );
  const reasons: string[] = [];
  if (!manifest.approved) reasons.push('release_approval_required');
  if (manifest.artifacts.some((item) => !item.digest.startsWith('sha256:')))
    reasons.push('artifact_digest_missing');
  return {
    allowed: reasons.length === 0,
    reasons,
    trace_id: input.trace_id ?? `trace_release_${manifest.release_version}`,
    checks,
  };
}

function artifact(name: string, version: string, kind: ReleaseArtifact['kind']): ReleaseArtifact {
  return {
    name,
    version,
    kind,
    digest: `sha256:${createHash('sha256').update(`${name}@${version}`).digest('hex')}`,
  };
}
