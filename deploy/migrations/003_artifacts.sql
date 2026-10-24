-- T2.1 Artifact metadata is authoritative for scope, version and integrity.
-- Blob bytes live in object storage and are addressed only by storage_key.
CREATE TABLE IF NOT EXISTS wcp_artifacts (
  artifact_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES wcp_tenants(id),
  workspace_id TEXT NOT NULL REFERENCES wcp_workspaces(id),
  project_id TEXT NOT NULL REFERENCES wcp_projects(id),
  storage_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  etag TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS wcp_artifact_versions (
  artifact_id TEXT NOT NULL REFERENCES wcp_artifacts(artifact_id),
  version BIGINT NOT NULL CHECK (version > 0),
  sha256 TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  storage_key TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (artifact_id, version)
);

CREATE INDEX IF NOT EXISTS idx_wcp_artifacts_scope
  ON wcp_artifacts (tenant_id, workspace_id, project_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_wcp_artifact_versions_artifact
  ON wcp_artifact_versions (artifact_id, version);

INSERT INTO schema_migrations (version, checksum)
VALUES ('003_artifacts', 'sha256:planemem-p2-003')
ON CONFLICT (version) DO NOTHING;
