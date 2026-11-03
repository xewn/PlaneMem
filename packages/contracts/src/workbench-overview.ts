export const OVERVIEW_COUNT_FIELDS = [
  'total_work_items',
  'todo_work_items',
  'in_progress_work_items',
  'in_review_work_items',
  'cancelled_work_items',
  'active_work_items',
  'blocked_work_items',
  'completed_work_items',
  'active_sessions',
  'open_conflicts',
  'total_context_items',
  'proposed_context_items',
  'expired_context_items',
] as const;

export interface OverviewContextPreview {
  id: string;
  title: string;
  item_type: string;
  layer: string;
  status: string;
  expires_at: string | null;
  content?: unknown;
}

export type WorkbenchOverview = Record<(typeof OVERVIEW_COUNT_FIELDS)[number], number> & {
  project_id: string;
  project_name: string;
  external_id: string;
  read_at: string;
  last_activity_at: string;
  context_layers: Array<{
    layer: string;
    count: number;
    proposed: number;
    expired: number;
    average_confidence: number | null;
  }>;
  project_brief: OverviewContextPreview | null;
  proposed_context_preview: OverviewContextPreview[];
  expired_context_preview: OverviewContextPreview[];
  active_session_preview: Array<{
    session_id: string;
    client_id: string;
    status: 'running';
    run_count: number;
    tool_call_count: number;
  }>;
  open_conflict_preview: Array<{
    conflict_id: string;
    entity_type: string;
    field: string;
    status: 'open';
  }>;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid overview object');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Invalid overview text');
  return value;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError('Invalid overview count');
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new TypeError('Invalid overview timestamp');
  return value;
}
function rows(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new TypeError('Invalid overview preview size');
  return value;
}
function context(value: unknown): OverviewContextPreview {
  const item = object(value);
  if (
    !['L0', 'L1', 'L2', 'L3', 'L4'].includes(text(item.layer)) ||
    !['confirmed', 'proposed', 'expired', 'excluded'].includes(text(item.status))
  )
    throw new TypeError('Invalid overview context');
  const id = text(item.id);
  if (!id) throw new TypeError('Missing overview context ID');
  return {
    id,
    title: text(item.title),
    item_type: text(item.item_type),
    layer: text(item.layer),
    status: text(item.status),
    expires_at: item.expires_at === null ? null : timestamp(item.expires_at),
    ...('content' in item ? { content: item.content } : {}),
  };
}

export function parseWorkbenchOverview(value: unknown): WorkbenchOverview {
  const item = object(value);
  const counts = Object.fromEntries(
    OVERVIEW_COUNT_FIELDS.map((key) => [key, count(item[key])]),
  ) as Record<(typeof OVERVIEW_COUNT_FIELDS)[number], number>;
  const context_layers = rows(item.context_layers, 5).map((value) => {
    const row = object(value);
    const layer = text(row.layer);
    if (!['L0', 'L1', 'L2', 'L3', 'L4'].includes(layer))
      throw new TypeError('Invalid overview layer');
    const average = row.average_confidence;
    if (
      average !== null &&
      (typeof average !== 'number' || !Number.isFinite(average) || average < 0 || average > 1)
    )
      throw new TypeError('Invalid overview confidence');
    const total = count(row.count),
      proposed = count(row.proposed),
      expired = count(row.expired);
    if (proposed > total || expired > total || (total === 0) !== (average === null))
      throw new TypeError('Invalid overview layer totals');
    return { layer, count: total, proposed, expired, average_confidence: average as number | null };
  });
  if (
    context_layers.length !== 5 ||
    new Set(context_layers.map((row) => row.layer)).size !== 5 ||
    context_layers.reduce((sum, row) => sum + row.count, 0) !== counts.total_context_items ||
    context_layers.reduce((sum, row) => sum + row.proposed, 0) !== counts.proposed_context_items ||
    context_layers.reduce((sum, row) => sum + row.expired, 0) !== counts.expired_context_items ||
    counts.active_work_items !==
      counts.todo_work_items +
        counts.in_progress_work_items +
        counts.in_review_work_items +
        counts.blocked_work_items ||
    counts.total_work_items !==
      counts.active_work_items + counts.completed_work_items + counts.cancelled_work_items
  )
    throw new TypeError('Inconsistent overview totals');
  const read_at = timestamp(item.read_at);
  const proposed_context_preview = rows(item.proposed_context_preview, 3).map(context);
  const expired_context_preview = rows(item.expired_context_preview, 2).map(context);
  const project_brief = item.project_brief === null ? null : context(item.project_brief);
  const expired = (row: OverviewContextPreview) =>
    row.status === 'expired' ||
    (row.expires_at !== null && Date.parse(row.expires_at) <= Date.parse(read_at));
  if (
    proposed_context_preview.some((row) => row.status !== 'proposed') ||
    expired_context_preview.some((row) => !expired(row)) ||
    // Database timestamps may contain sub-millisecond precision; equality after parsing
    // cannot disprove the SQL selection's strictly-future expiry.
    (project_brief &&
      (project_brief.layer !== 'L0' ||
        project_brief.status !== 'confirmed' ||
        (project_brief.expires_at !== null &&
          Date.parse(project_brief.expires_at) < Date.parse(read_at))))
  )
    throw new TypeError('Invalid overview context selection');
  const active_session_preview = rows(item.active_session_preview, 4).map((value) => {
    const row = object(value);
    if (row.status !== 'running') throw new TypeError('Invalid overview session state');
    return {
      session_id: text(row.session_id),
      client_id: text(row.client_id),
      status: 'running' as const,
      run_count: count(row.run_count),
      tool_call_count: count(row.tool_call_count),
    };
  });
  const open_conflict_preview = rows(item.open_conflict_preview, 3).map((value) => {
    const row = object(value);
    if (row.status !== 'open') throw new TypeError('Invalid overview conflict state');
    return {
      conflict_id: text(row.conflict_id),
      entity_type: text(row.entity_type),
      field: text(row.field),
      status: 'open' as const,
    };
  });
  for (const [preview, total, max, key] of [
    [proposed_context_preview, counts.proposed_context_items, 3, 'id'],
    [expired_context_preview, counts.expired_context_items, 2, 'id'],
    [active_session_preview, counts.active_sessions, 4, 'session_id'],
    [open_conflict_preview, counts.open_conflicts, 3, 'conflict_id'],
  ] as const) {
    const ids = preview.map((row) => text((row as unknown as Record<string, unknown>)[key]));
    if (
      preview.length !== Math.min(total, max) ||
      ids.some((id) => !id) ||
      new Set(ids).size !== ids.length
    )
      throw new TypeError('Inconsistent overview preview');
  }
  return {
    ...counts,
    project_id: text(item.project_id),
    project_name: text(item.project_name),
    external_id: text(item.external_id),
    read_at,
    last_activity_at: timestamp(item.last_activity_at),
    context_layers,
    project_brief,
    proposed_context_preview,
    expired_context_preview,
    active_session_preview,
    open_conflict_preview,
  };
}
