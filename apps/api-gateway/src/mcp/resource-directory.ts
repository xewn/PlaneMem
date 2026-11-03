import { createHash } from 'node:crypto';
import { ContractError, isSyncIdentifier, isUlid } from '@planemem/contracts';
import { proposalVisibility } from '../proposals.js';
import type { RequestContext } from '../router.js';
import type { WorkbenchDatabase } from '../workbench/repository.js';

// The ordering is part of the cursor format; change its version when changing this list.
const kinds = [
  'overview',
  'context-item',
  'legacy-context',
  'proposal',
  'work-item',
  'session-checkpoint',
  'session-handoff',
  'context-pack',
] as const;
type Position = { kind: number; id: string };
const pageSize = 100;
// Full pack validation traverses source graphs. Bound work separately from metadata pagination.
const packScanLimit = 8;
const packKind = 7;
const cursorVersion = 2;

function key(context: RequestContext): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'mcp-resource-directory-v2',
        context.tenant_id,
        context.workspace_id,
        context.project_id,
        context.capability.includes('data.restricted.read'),
      ]),
    )
    .digest('hex');
}

function encode(position: Position, bound: string): string {
  return Buffer.from(JSON.stringify([cursorVersion, bound, position.kind, position.id])).toString(
    'base64url',
  );
}

function validPosition(value: Position, context: RequestContext): boolean {
  return (
    Number.isInteger(value.kind) &&
    value.kind >= 0 &&
    value.kind < kinds.length &&
    isSyncIdentifier(value.id) &&
    value.id !== '.' &&
    value.id !== '..' &&
    (value.kind !== 0 || value.id === context.project_id) &&
    (![3, packKind].includes(value.kind) || isUlid(value.id))
  );
}

function decode(value: unknown, bound: string, context: RequestContext): Position | undefined {
  if (value === undefined) return;
  try {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,4096}$/.test(value)) throw new Error();
    const parts: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !Array.isArray(parts) ||
      parts.length !== 4 ||
      parts[0] !== cursorVersion ||
      parts[1] !== bound
    )
      throw new Error();
    const position = { kind: parts[2], id: parts[3] };
    if (!validPosition(position, context) || encode(position, bound) !== value) throw new Error();
    return position;
  } catch {
    throw new ContractError(
      'INVALID_INPUT',
      'Invalid resource cursor; restart with the current scope and permissions',
      {
        trace_id: context.trace_id,
      },
    );
  }
}

function resourceUri(position: Position, context: RequestContext): string {
  const id = encodeURIComponent(position.id);
  if (position.kind === 2) return `wcp://context/${id}`;
  if (position.kind === 5) return `work://session/${id}/checkpoint`;
  if (position.kind === 6) return `work://session/${id}/handoff`;
  const project = `work://project/${encodeURIComponent(context.project_id)}`;
  return position.kind === 0 ? `${project}/overview` : `${project}/${kinds[position.kind]}/${id}`;
}

/** A live URI-only directory. Pack candidates pass through the normal validated read. */
export class McpResourceDirectory {
  constructor(private readonly db: WorkbenchDatabase | undefined) {}

  private async query<T>(sql: string, params: unknown[], context: RequestContext): Promise<T[]> {
    if (this.db) {
      try {
        return await this.db.query<T>(sql, params);
      } catch {
        // Keep database details out of the protocol response; never fall back to a cache.
      }
    }
    throw new ContractError('MCP_STORAGE_UNAVAILABLE', 'MCP resource storage is unavailable', {
      trace_id: context.trace_id,
      retryable: true,
    });
  }

  async requireProject(context: RequestContext): Promise<void> {
    const rows = await this.query<{ id: string }>(
      `SELECT id FROM wcp_projects WHERE tenant_id = $1 AND workspace_id = $2 AND id = $3
        AND deleted_at IS NULL AND ($4::boolean OR classification <> 'restricted')`,
      [
        context.tenant_id,
        context.workspace_id,
        context.project_id,
        context.capability.includes('data.restricted.read'),
      ],
      context,
    );
    if (!rows.length)
      throw new ContractError('MCP_RESOURCE_NOT_FOUND', 'MCP resource not found', {
        trace_id: context.trace_id,
      });
  }

  async list(context: RequestContext, cursor: unknown, checkPack: (id: string) => Promise<void>) {
    const bound = key(context);
    const after = decode(cursor, bound, context);
    const continuation = (kind: number, id: string) =>
      `(${kind} > $5::integer OR (${kind} = $5::integer AND ${id} COLLATE "C" > $6::text COLLATE "C"))`;
    const branches = [
      `SELECT 0 AS kind, v.id FROM visible_project v WHERE ${continuation(0, 'v.id')}`,
      `SELECT 1 AS kind, c.id FROM wcp_context_items c JOIN visible_project v ON v.id = c.project_id
        WHERE c.tenant_id = $1 AND c.workspace_id = $2 AND c.deleted_at IS NULL
          AND ($4::boolean OR c.classification <> 'restricted') AND ${continuation(1, 'c.id')}`,
      `SELECT 2 AS kind, h.id FROM wcp_context_hits h JOIN visible_project v ON v.id = h.project_id
        WHERE h.tenant_id = $1 AND h.workspace_id = $2 AND h.deleted_at IS NULL
          AND (h.expires_at IS NULL OR h.expires_at > statement_timestamp())
          AND ($4::boolean OR h.classification <> 'restricted') AND ${continuation(2, 'h.id')}`,
      `SELECT 3 AS kind, p.proposal_id AS id FROM wcp_proposals p JOIN visible_project v ON v.id = p.project_id
        WHERE p.tenant_id = $1 AND p.workspace_id = $2 AND (${proposalVisibility(context)})
          AND ${continuation(3, 'p.proposal_id')}`,
      `SELECT 4 AS kind, w.id FROM wcp_work_items w JOIN visible_project v ON v.id = w.project_id
        WHERE w.tenant_id = $1 AND w.workspace_id = $2 AND w.deleted_at IS NULL
          AND ($4::boolean OR w.classification <> 'restricted') AND ${continuation(4, 'w.id')}`,
      `SELECT DISTINCT 5 AS kind, c.session_id COLLATE "C" AS id FROM wcp_session_checkpoints c
        JOIN visible_project v ON v.id = c.project_id
        WHERE c.tenant_id = $1 AND c.workspace_id = $2 AND ${continuation(5, 'c.session_id')}`,
      `SELECT DISTINCT 6 AS kind, c.session_id COLLATE "C" AS id FROM wcp_session_checkpoints c
        JOIN visible_project v ON v.id = c.project_id
        WHERE c.tenant_id = $1 AND c.workspace_id = $2 AND ${continuation(6, 'c.session_id')}
          AND EXISTS (SELECT 1 FROM wcp_session_handoffs h WHERE h.checkpoint_id = c.checkpoint_id
            AND h.tenant_id = c.tenant_id AND h.workspace_id = c.workspace_id AND h.project_id = c.project_id)
        UNION
        SELECT DISTINCT 6 AS kind, h.session_id COLLATE "C" AS id FROM wcp_handoffs h
        JOIN visible_project v ON v.id = h.project_id
        WHERE h.tenant_id = $1 AND h.workspace_id = $2 AND ${continuation(6, 'h.session_id')}
          AND NOT EXISTS (SELECT 1 FROM wcp_session_handoffs c WHERE c.handoff_id = h.handoff_id
            AND c.tenant_id = h.tenant_id AND c.workspace_id = h.workspace_id AND c.project_id = h.project_id)`,
      `SELECT 7 AS kind, p.pack_id AS id FROM wcp_context_packs p
        JOIN visible_project v ON v.id = p.project_id
        WHERE p.tenant_id = $1 AND p.workspace_id = $2 AND p.pack_document IS NOT NULL
          AND ($4::boolean OR NOT p.read_restricted) AND p.expires_at > statement_timestamp()
          AND ${continuation(packKind, 'p.pack_id')}`,
    ];
    const rows = await this.query<Position>(
      `WITH visible_project AS MATERIALIZED (
        SELECT id FROM wcp_projects WHERE tenant_id = $1 AND workspace_id = $2 AND id = $3
          AND deleted_at IS NULL AND ($4::boolean OR classification <> 'restricted')
      ), candidates AS (${branches.map((branch, kind) => `(SELECT * FROM (${branch}) entry ORDER BY id COLLATE "C" LIMIT ${kind === packKind ? packScanLimit + 1 : pageSize + 1})`).join(' UNION ALL ')})
      SELECT kind, id FROM candidates ORDER BY kind, id COLLATE "C" LIMIT ${pageSize + 1}`,
      [
        context.tenant_id,
        context.workspace_id,
        context.project_id,
        context.capability.includes('data.restricted.read'),
        after?.kind ?? -1,
        after?.id ?? '',
      ],
      context,
    );
    if (rows.some((row) => !validPosition(row, context)))
      throw new ContractError('MCP_RESOURCE_INVALID', 'Stored resource metadata is invalid', {
        trace_id: context.trace_id,
      });
    const scanned: Position[] = [];
    const page: Position[] = [];
    let packsChecked = 0;
    for (const row of rows) {
      if (scanned.length >= pageSize || (row.kind === packKind && packsChecked >= packScanLimit))
        break;
      scanned.push(row);
      if (row.kind === packKind) {
        packsChecked++;
        try {
          // The normal read includes authorization, project visibility, hash, expiry and source checks.
          await checkPack(row.id);
        } catch (error) {
          if (
            error instanceof ContractError &&
            [
              'DENIED',
              'CONTEXT_PACK_NOT_FOUND',
              'CONTEXT_PACK_EXPIRED',
              'CONTEXT_PACK_STALE',
            ].includes(error.envelope.code)
          )
            continue;
          // Unavailability and corrupt storage must not masquerade as an empty directory.
          throw error;
        }
      }
      page.push(row);
    }
    const last = scanned[scanned.length - 1];
    return {
      resources: page.map((row) => {
        const uri = resourceUri(row, context);
        return { uri, name: uri, mimeType: 'application/json' };
      }),
      // Continue after the last inspected candidate, even when every inspected pack was stale.
      ...(last && rows.length > scanned.length ? { nextCursor: encode(last, bound) } : {}),
    };
  }
}
