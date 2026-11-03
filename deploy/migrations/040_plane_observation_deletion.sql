-- Development only; not executed. Preserve ordered work-item deletion observations.
ALTER TABLE wcp_projection_states ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'wcp_projection_deletion_shape' AND conrelid = 'wcp_projection_states'::regclass) THEN
    ALTER TABLE wcp_projection_states
      ADD CONSTRAINT wcp_projection_deletion_shape CHECK (
        deleted_at IS NULL OR (
          entity_kind = 'WorkItem' AND deleted_at = observed_at AND status IS NULL
          AND fields = jsonb_build_object('external_id', external_id)
        )
      );
  END IF;
END $$;
INSERT INTO schema_migrations (version, checksum)
VALUES ('040_plane_observation_deletion', 'sha256:planemem-plane-observation-deletion-040')
ON CONFLICT (version) DO NOTHING;
