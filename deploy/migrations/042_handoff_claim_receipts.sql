-- Development only; not executed. Claim and success receipt commit together.
CREATE TABLE IF NOT EXISTS wcp_handoff_claim_commands (
  tenant_id TEXT NOT NULL REFERENCES wcp_tenants(id),
  workspace_id TEXT NOT NULL REFERENCES wcp_workspaces(id),
  project_id TEXT NOT NULL REFERENCES wcp_projects(id),
  request_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  handoff_id TEXT NOT NULL REFERENCES wcp_session_handoffs(handoff_id),
  response_document JSONB NOT NULL CHECK (jsonb_typeof(response_document) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workspace_id, project_id, request_key),
  CHECK (request_key ~ '^[a-f0-9]{64}$'),
  CHECK (request_fingerprint ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_wcp_handoff_claim_commands_handoff
  ON wcp_handoff_claim_commands (tenant_id, workspace_id, project_id, handoff_id);

INSERT INTO schema_migrations (version, checksum)
VALUES ('042_handoff_claim_receipts', 'sha256:planemem-handoff-claim-receipts-042')
ON CONFLICT (version) DO NOTHING;
