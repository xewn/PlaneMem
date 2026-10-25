INSERT INTO wcp_tenants (id, name, classification)
VALUES ('01HF7YAT000000000000000001', 'tenant-demo', 'internal')
ON CONFLICT (id) DO NOTHING;

INSERT INTO wcp_workspaces (id, tenant_id, name, classification)
VALUES (
  '01HF7YAT000000000000000002',
  '01HF7YAT000000000000000001',
  'workspace-demo',
  'internal'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO wcp_projects (id, tenant_id, workspace_id, name, external_id, classification)
VALUES (
  '01HF7YAT000000000000000003',
  '01HF7YAT000000000000000001',
  '01HF7YAT000000000000000002',
  'project-continuity',
  'fixture-demo-project',
  'internal'
)
ON CONFLICT (id) DO NOTHING;
