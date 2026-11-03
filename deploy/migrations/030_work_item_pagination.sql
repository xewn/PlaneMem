-- Source-only development migration; apply through the normal deployment process.
-- Match keyset order for active scoped work items, with and without a status filter.
CREATE INDEX IF NOT EXISTS idx_wcp_work_items_active_page
  ON wcp_work_items (tenant_id, workspace_id, project_id, updated_at DESC, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_wcp_work_items_active_status_page
  ON wcp_work_items (tenant_id, workspace_id, project_id, status, updated_at DESC, id)
  WHERE deleted_at IS NULL;
