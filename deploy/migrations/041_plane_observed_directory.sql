-- Development only; not executed. Supports scoped keyset pagination of current observations.
CREATE INDEX IF NOT EXISTS wcp_plane_observed_directory_idx
  ON wcp_projection_states (tenant_id, workspace_id, project_id, external_id COLLATE "C")
  WHERE entity_kind = 'WorkItem' AND authority = 'plane';

INSERT INTO schema_migrations (version, checksum)
VALUES ('041_plane_observed_directory', 'sha256:planemem-plane-observed-directory-041')
ON CONFLICT (version) DO NOTHING;
