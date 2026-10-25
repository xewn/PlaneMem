-- Workbench projection owned by PlaneMem. Plane remains the authority for the
-- external work-item identity; these rows are the read-optimized projection.
CREATE TABLE IF NOT EXISTS wcp_work_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES wcp_tenants(id),
  workspace_id TEXT NOT NULL REFERENCES wcp_workspaces(id),
  project_id TEXT NOT NULL REFERENCES wcp_projects(id),
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled')),
  priority TEXT NOT NULL CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  owner TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  description TEXT NOT NULL DEFAULT '',
  due_at TIMESTAMPTZ,
  classification TEXT NOT NULL CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (project_id, external_id)
);

CREATE TABLE IF NOT EXISTS wcp_context_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES wcp_tenants(id),
  workspace_id TEXT NOT NULL REFERENCES wcp_workspaces(id),
  project_id TEXT NOT NULL REFERENCES wcp_projects(id),
  title TEXT NOT NULL,
  item_type TEXT NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('L0', 'L1', 'L2', 'L3', 'L4')),
  classification TEXT NOT NULL CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'proposed', 'expired', 'excluded')),
  source_ref TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  priority TEXT NOT NULL CHECK (priority IN ('High', 'Medium', 'Low')),
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS wcp_context_packs (
  pack_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES wcp_tenants(id),
  workspace_id TEXT NOT NULL REFERENCES wcp_workspaces(id),
  project_id TEXT NOT NULL REFERENCES wcp_projects(id),
  version BIGINT NOT NULL DEFAULT 1,
  pack_hash TEXT NOT NULL,
  budget_tokens INTEGER NOT NULL,
  used_tokens INTEGER NOT NULL,
  scope JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('latest', 'expired', 'proposed')),
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  trace_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wcp_handoffs (
  handoff_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES wcp_tenants(id),
  workspace_id TEXT NOT NULL REFERENCES wcp_workspaces(id),
  project_id TEXT NOT NULL REFERENCES wcp_projects(id),
  session_id TEXT NOT NULL REFERENCES wcp_sessions(session_id),
  checkpoint_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('offered', 'accepted', 'expired', 'rejected')),
  offered_to TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wcp_work_items_scope_status
  ON wcp_work_items (tenant_id, workspace_id, project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wcp_context_items_scope_layer
  ON wcp_context_items (tenant_id, workspace_id, project_id, layer, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wcp_context_packs_scope_latest
  ON wcp_context_packs (tenant_id, workspace_id, project_id, status, version DESC);
CREATE INDEX IF NOT EXISTS idx_wcp_handoffs_scope_status
  ON wcp_handoffs (tenant_id, workspace_id, project_id, status, updated_at DESC);

INSERT INTO schema_migrations (version, checksum)
VALUES ('008_workbench_projection', 'sha256:planemem-p5-008')
ON CONFLICT (version) DO NOTHING;
