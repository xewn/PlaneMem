-- Source only: not executed. Requires 003_artifacts.
-- Preserve legacy version rows; unknown historical metadata is never backfilled.
ALTER TABLE wcp_artifact_versions ADD COLUMN IF NOT EXISTS metadata_snapshot JSONB;

CREATE TABLE IF NOT EXISTS wcp_artifact_command_receipts (
  receipt_id TEXT PRIMARY KEY CHECK (receipt_id ~ '^[a-f0-9]{64}$'),
  tenant_id TEXT NOT NULL REFERENCES wcp_tenants(id),
  workspace_id TEXT NOT NULL REFERENCES wcp_workspaces(id),
  project_id TEXT NOT NULL REFERENCES wcp_projects(id),
  actor_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('artifact.create', 'artifact.put-version')),
  command_hash TEXT NOT NULL CHECK (command_hash ~ '^[a-f0-9]{64}$'),
  command JSONB NOT NULL CHECK (jsonb_typeof(command) = 'object'),
  artifact_id TEXT NOT NULL,
  artifact_version BIGINT NOT NULL CHECK (artifact_version > 0),
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (artifact_id, artifact_version) REFERENCES wcp_artifact_versions(artifact_id, version)
);
CREATE INDEX IF NOT EXISTS idx_artifact_receipts_scope
  ON wcp_artifact_command_receipts (tenant_id, workspace_id, project_id, artifact_id);

INSERT INTO schema_migrations (version, checksum)
VALUES ('045_artifact_command_receipts', 'sha256:planemem-p2-045')
ON CONFLICT (version) DO NOTHING;
