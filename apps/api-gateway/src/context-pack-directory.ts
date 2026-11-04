import { createHash } from 'node:crypto';
import {
  ContractError,
  isSyncIdentifier,
  isUlid,
  syncJsonSnapshot,
  compareContextPackDirectoryPositions,
  encodeContextPackDirectoryCursor,
  parseContextPackDirectoryCursor,
  parseContextPackDirectoryQuery,
  parseContextPackDirectoryRecord,
  parseContextPackDirectoryEnvelope,
  type ContextPackDirectoryRecord,
  type ContextPackDirectoryQuery,
} from '@planemem/contracts';
import type { CommandRouter, RequestContext } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';

const activeReads = new WeakMap<CommandRouter, { active: number }>();
function failure(code: string, trace: string) {
  const messages: Record<string, string> = {
    DENIED: 'Use a verified unexpired client with actual context.read and complete identity',
    INVALID_INPUT:
      'Use a valid saved pack filter and current cursor; restart when identity or page size changes',
    CONTEXT_PACK_NOT_FOUND: 'The saved pack project is unavailable',
    CONTEXT_PACK_INVALID: 'The complete saved pack metadata page is invalid',
    CONTEXT_PACK_STORAGE_UNAVAILABLE: 'Saved pack metadata storage is unavailable',
    CONTEXT_PACK_DIRECTORY_TIMEOUT:
      'Stopped waiting for saved pack metadata; the underlying read may still be running',
    RATE_LIMITED: 'Saved pack directory read capacity is occupied',
  };
  return new ContractError(code, messages[code]!, { trace_id: trace, retryable: false });
}
function authority(context: RequestContext) {
  return (
    context.schema_version === 1 &&
    context.authenticated_client === true &&
    [context.tenant_id, context.workspace_id, context.project_id, context.actor_id].every(isUlid) &&
    isSyncIdentifier(context.client_id) &&
    isSyncIdentifier(context.trace_id) &&
    Array.isArray(context.capability) &&
    context.capability.every(isSyncIdentifier) &&
    context.capability.includes('context.read') &&
    (context.roles === undefined ||
      (Array.isArray(context.roles) && context.roles.every(isSyncIdentifier))) &&
    Date.parse(context.token_expires_at ?? '') > Date.now()
  );
}

export function registerContextPackDirectory(
  router: CommandRouter,
  database: RuntimeSql | undefined,
) {
  router.register('context.pack.list', async (request) => {
    const deadline = performance.now() + 30_000;
    const context = structuredClone(request.context);
    const trace = isSyncIdentifier(context.trace_id) ? context.trace_id : 'trace_unknown';
    const active = () => {
      if (performance.now() >= deadline) throw failure('CONTEXT_PACK_DIRECTORY_TIMEOUT', trace);
      if (!authority(context)) throw failure('DENIED', trace);
    };
    active();
    delete context.idempotency_key;
    delete context.expected_version;
    Reflect.deleteProperty(context, 'if_match');
    let query: ContextPackDirectoryQuery;
    let before: ReturnType<typeof parseContextPackDirectoryCursor> | undefined;
    let bound: string;
    try {
      query = parseContextPackDirectoryQuery(request.input);
      bound = createHash('sha256')
        .update(
          JSON.stringify([
            'context-pack-directory-v1',
            context.tenant_id,
            context.workspace_id,
            context.project_id,
            context.actor_id,
            context.client_id,
            context.actor_type ?? null,
            [...new Set(context.roles ?? [])].sort(),
            [...new Set(context.capability)].sort(),
            query.limit,
            query.pack_id ?? null,
          ]),
        )
        .digest('hex');
      before =
        query.cursor === undefined ? undefined : parseContextPackDirectoryCursor(query.cursor);
      if (before && before.key !== bound) throw new TypeError();
    } catch {
      throw failure('INVALID_INPUT', trace);
    }
    if (!database) throw failure('CONTEXT_PACK_STORAGE_UNAVAILABLE', trace);
    const db = database;
    let gate = activeReads.get(router);
    if (!gate) {
      gate = { active: 0 };
      activeReads.set(router, gate);
    }
    if (gate.active >= 2) throw failure('RATE_LIMITED', trace);
    const lease = gate;
    lease.active++;
    const work = (async () => {
      try {
        const restricted = context.capability.includes('data.restricted.read');
        const data = await db.begin('isolation level repeatable read read only', async (tx) => {
          active();
          const projects = await tx`SELECT id FROM wcp_projects
            WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id}
              AND id = ${context.project_id} AND deleted_at IS NULL
              AND (${restricted} OR classification <> 'restricted') LIMIT 1`;
          active();
          if (!projects.length) throw failure('CONTEXT_PACK_NOT_FOUND', trace);
          // Only bounded scalar metadata is selected; saved content and source manifests stay unread.
          const rows =
            await tx`SELECT pack_id, version, created_at, expires_at, budget_tokens, used_tokens
            FROM wcp_context_packs
            WHERE tenant_id = ${context.tenant_id} AND workspace_id = ${context.workspace_id}
              AND project_id = ${context.project_id} AND pack_document IS NOT NULL
              AND (${restricted} OR NOT read_restricted)
              AND (${query.pack_id ?? null}::text IS NULL OR pack_id = ${query.pack_id ?? null})
              AND (${before?.version ?? null}::bigint IS NULL OR version < ${before?.version ?? null}
                OR (version = ${before?.version ?? null} AND pack_id COLLATE "C" < ${before?.pack_id ?? null}))
            ORDER BY version DESC, pack_id COLLATE "C" DESC LIMIT ${query.limit + 1}`;
          active();
          try {
            if (rows.length > query.limit + 1) throw new TypeError();
            const records = rows.map((row) =>
              parseContextPackDirectoryRecord({
                pack_id: row.pack_id,
                version: Number(row.version),
                created_at: new Date(row.created_at).toISOString(),
                expires_at: new Date(row.expires_at).toISOString(),
                budget_tokens: row.budget_tokens,
                used_tokens: row.used_tokens,
              }),
            );
            syncJsonSnapshot(records, 256 * 1024);
            if (
              records.length > query.limit + 1 ||
              records.some(
                (row, index) =>
                  (query.pack_id !== undefined && row.pack_id !== query.pack_id) ||
                  (before && compareContextPackDirectoryPositions(before, row) >= 0) ||
                  (index > 0 &&
                    compareContextPackDirectoryPositions(records[index - 1]!, row) >= 0),
              ) ||
              new Set(records.map((row) => row.pack_id)).size !== records.length
            )
              throw new TypeError();
            return records;
          } catch {
            throw failure('CONTEXT_PACK_INVALID', trace);
          }
        });
        active();
        const page = (data as ContextPackDirectoryRecord[]).slice(0, query.limit);
        try {
          const result = parseContextPackDirectoryEnvelope(
            {
              schema_version: 1,
              trace_id: trace,
              source_refs: [{ type: 'context-pack-directory', id: context.project_id }],
              scope: {
                tenant_id: context.tenant_id,
                workspace_id: context.workspace_id,
                project_id: context.project_id,
              },
              query,
              content_state: 'metadata-only',
              source_state: 'not-checked',
              data: page,
              ...(data.length > query.limit
                ? { next_cursor: encodeContextPackDirectoryCursor(bound, page.at(-1)!) }
                : {}),
            },
            query,
            context,
            trace,
          );
          active();
          return result;
        } catch (error) {
          active();
          if (error instanceof ContractError) throw error;
          throw failure('CONTEXT_PACK_INVALID', trace);
        }
      } catch (error) {
        active();
        if (error instanceof ContractError) throw error;
        throw failure('CONTEXT_PACK_STORAGE_UNAVAILABLE', trace);
      } finally {
        lease.active--;
      }
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(failure('CONTEXT_PACK_DIRECTORY_TIMEOUT', trace)),
            Math.max(1, deadline - performance.now()),
          );
          timer.unref();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  });
}
