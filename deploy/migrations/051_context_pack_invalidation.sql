-- Source only. No historical dependency versions are inferred or backfilled.
CREATE UNIQUE INDEX IF NOT EXISTS uq_context_pack_scope_id
  ON wcp_context_packs (tenant_id, workspace_id, project_id, pack_id);

CREATE TABLE IF NOT EXISTS wcp_context_pack_dependencies (
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version BIGINT NOT NULL CHECK (source_version BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY (pack_id, source_id),
  FOREIGN KEY (tenant_id, workspace_id, project_id, pack_id)
    REFERENCES wcp_context_packs (tenant_id, workspace_id, project_id, pack_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_context_pack_dependency_source
  ON wcp_context_pack_dependencies (tenant_id, workspace_id, project_id, source_id, source_version);

CREATE TABLE IF NOT EXISTS wcp_context_pack_invalidations (
  pack_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  saved_source_version BIGINT NOT NULL CHECK (saved_source_version > 0),
  changed_source_version BIGINT NOT NULL CHECK (changed_source_version > saved_source_version),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  stream_name TEXT NOT NULL,
  stream_sequence BIGINT NOT NULL CHECK (stream_sequence > 0),
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, workspace_id, project_id, pack_id)
    REFERENCES wcp_context_packs (tenant_id, workspace_id, project_id, pack_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_context_pack_invalidation_scope
  ON wcp_context_pack_invalidations (tenant_id, workspace_id, project_id, recorded_at);

INSERT INTO schema_migrations (version, checksum)
VALUES ('051_context_pack_invalidation', 'sha256:planemem-p2-051')
ON CONFLICT (version) DO NOTHING;
