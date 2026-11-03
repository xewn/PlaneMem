-- Development migration only; not executed. Indexes track source changes in the same transaction.
CREATE INDEX IF NOT EXISTS idx_wcp_work_items_search_fts
ON wcp_work_items USING GIN ((
  setweight(to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(external_id, '')), 'A') ||
  setweight(to_tsvector('simple'::regconfig, coalesce(description, '') || ' ' || coalesce(owner, '')), 'B')
)) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_wcp_context_items_search_fts
ON wcp_context_items USING GIN ((
  setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A') ||
  setweight(to_tsvector('simple'::regconfig, coalesce(
    (CASE jsonb_typeof(content) WHEN 'string' THEN content #>> '{}' ELSE content::text END), ''
  )), 'B')
)) WHERE deleted_at IS NULL;
