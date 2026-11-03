-- Supports project-scoped direct-revision browsing; supplied for a later database upgrade.
CREATE INDEX IF NOT EXISTS wcp_proposals_derivation_page_idx
  ON wcp_proposals (
    tenant_id, workspace_id, project_id,
    (provenance->'derived_from'->>'proposal_id'), proposal_id DESC
  ) WHERE provenance ? 'derived_from';
