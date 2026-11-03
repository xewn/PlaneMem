import {
  ContractError,
  createUlid,
  parsePlaneInboxIdentity,
  parsePlaneInboxRetryQuery,
  parsePlaneInboxRetryReceipt,
  validateIdempotencyKey,
  type PlaneInboxIdentity,
  type PlaneInboxRetryInput,
  type PlaneInboxRetryReceipt,
} from '@planemem/contracts';
import { buildPlaneObservedState } from '@planemem/plane-connector';
import { fingerprint } from './idempotency.js';
import { planeInboxMetadata, planeInboxVisibleRows } from './plane-inbox-reads.js';
import { readStoredPlaneInboxEvent, type StoredPlaneInboxRow } from './plane-inbox.js';
import type { CommandRouter, RequestContext } from './router.js';
import type { RuntimeSql } from './runtime-persistence.js';

/** Schedules the immutable event again; the normal worker still decides whether it can apply. */
export function registerPlaneInboxRetries(router: CommandRouter, db: RuntimeSql | undefined) {
  for (const lookup of [false, true]) {
    router.register(
      lookup ? 'plane.inbox.retry.receipt' : 'plane.inbox.retry',
      async ({ input, context }) => {
        if (
          context.authenticated_client !== true ||
          !context.roles?.includes('admin') ||
          (!lookup && context.actor_type !== 'human')
        )
          throw failure(
            context,
            'DENIED',
            'An authenticated administrator is required; scheduling also requires a human identity',
          );
        let command: PlaneInboxRetryInput;
        let identity: PlaneInboxIdentity;
        let key: string;
        try {
          if (context.expected_version !== undefined)
            throw new TypeError(
              'Use the original decimal expected_revision in the body, without version headers',
            );
          const query = parsePlaneInboxRetryQuery({
            ...input,
            request_key:
              input.request_key === undefined ? context.idempotency_key : input.request_key,
          });
          key = query.request_key;
          if (
            context.idempotency_key !== undefined &&
            validateIdempotencyKey(context.idempotency_key) !== key
          )
            throw new TypeError('Request key and Idempotency-Key disagree');
          const { request_key: _key, ...original } = query;
          command = original;
          identity = parsePlaneInboxIdentity({
            tenant_id: context.tenant_id,
            workspace_id: context.workspace_id,
            project_id: context.project_id,
            actor_id: context.actor_id,
            client_id: context.client_id,
          });
        } catch (error) {
          throw failure(
            context,
            'INVALID_INPUT',
            error instanceof Error ? error.message : 'Invalid retry command',
          );
        }
        if (!db) throw unavailable(context);
        const requestFingerprint = fingerprint({
          operation: 'plane.inbox.retry',
          identity,
          command,
        });
        let data;
        try {
          data = await db.begin(async (transaction) => {
            const tx = transaction as unknown as RuntimeSql;
            await tx`SET LOCAL lock_timeout = '3s'`;
            await tx`SET LOCAL statement_timeout = '15s'`;
            const requestLock = JSON.stringify([
              'plane-inbox-retry',
              identity.tenant_id,
              identity.workspace_id,
              identity.project_id,
              identity.actor_id,
              identity.client_id,
              key,
            ]);
            await tx`SELECT pg_advisory_xact_lock(hashtextextended(${requestLock}, 0))`;
            const [row] = await tx<
              StoredPlaneInboxRow[]
            >`SELECT *, aggregate_version::text AS aggregate_version, revision::text AS revision
            FROM wcp_plane_event_inbox WHERE tenant_id = ${identity.tenant_id} AND workspace_id = ${identity.workspace_id}
              AND project_id = ${identity.project_id} AND event_id = ${command.event_id} FOR UPDATE`;
            if (!row) throw missing(context);
            // Check visibility before decoding an event whose corruption might otherwise disclose its existence.
            await visibleRecord(tx, context, command.event_id);
            let state;
            try {
              state = buildPlaneObservedState(readStoredPlaneInboxEvent(row));
            } catch {
              throw invalid(context);
            }
            const indexLock = JSON.stringify([
              'context-index',
              identity.tenant_id,
              identity.workspace_id,
              identity.project_id,
              `plane:${state.entity_kind}:${state.external_id}`,
            ]);
            await tx`SELECT pg_advisory_xact_lock(hashtextextended(${indexLock}, 0))`;
            const parents =
              await tx`SELECT id FROM wcp_projects WHERE tenant_id = ${identity.tenant_id}
            AND workspace_id = ${identity.workspace_id} AND id = ${identity.project_id} AND deleted_at IS NULL FOR SHARE`;
            if (!parents.length) throw missing(context);
            const current = await visibleRecord(tx, context, command.event_id);
            const [saved] = await tx<
              {
                event_id: string;
                request_fingerprint: string;
                event_fingerprint: string;
                receipt: unknown;
              }[]
            >`SELECT event_id, request_fingerprint, event_fingerprint, receipt FROM wcp_plane_inbox_retries
            WHERE tenant_id = ${identity.tenant_id} AND workspace_id = ${identity.workspace_id} AND project_id = ${identity.project_id}
              AND actor_id = ${identity.actor_id} AND client_id = ${identity.client_id} AND request_key = ${key}`;
            if (saved) {
              if (
                saved.request_fingerprint !== requestFingerprint ||
                saved.event_id !== command.event_id
              )
                throw failure(
                  context,
                  'IDEMPOTENCY_KEY_REUSED',
                  'This key belongs to another retry command',
                );
              let receipt: PlaneInboxRetryReceipt;
              try {
                receipt = parsePlaneInboxRetryReceipt(saved.receipt, command, identity, key);
                const original = receipt.record;
                if (
                  saved.event_fingerprint !== row.event_fingerprint ||
                  BigInt(current.revision) < BigInt(original.revision) ||
                  BigInt(current.attempts) < BigInt(original.attempts) ||
                  original.aggregate_id !== current.aggregate_id ||
                  original.aggregate_type !== current.aggregate_type ||
                  original.aggregate_version !== current.aggregate_version ||
                  original.event_type !== current.event_type ||
                  original.received_at !== current.received_at
                )
                  throw new Error();
              } catch {
                throw invalid(context);
              }
              if (
                receipt.record.classification === 'restricted' &&
                !context.capability.includes('data.restricted.read')
              )
                throw missing(context);
              // Historical scheduling receipt, not a claim about the event's current processing status.
              return lookup
                ? { status: 'recorded' as const, identity, request_key: key, command, receipt }
                : receipt;
            }
            if (lookup)
              return { status: 'not-observed' as const, identity, request_key: key, command };
            if (current.revision !== command.expected_revision)
              throw failure(
                context,
                'PLANE_INBOX_REVISION_CONFLICT',
                'Queue state changed; read the current event receipt before preparing another command',
              );
            if (current.status === 'applied')
              throw failure(
                context,
                'PLANE_INBOX_STATE_CONFLICT',
                'An applied event cannot be scheduled again',
              );
            // One timestamp is shared by both fields; attempts and the original event remain untouched.
            const changed =
              await tx`UPDATE wcp_plane_event_inbox SET status = 'pending', last_error_code = NULL,
            applied_at = NULL, next_attempt_at = statement_timestamp(), updated_at = statement_timestamp(), revision = revision + 1
            WHERE event_id = ${command.event_id} AND revision = ${command.expected_revision}::bigint
              AND status IN ('pending', 'rejected') RETURNING event_id`;
            if (changed.length !== 1)
              throw failure(context, 'PLANE_INBOX_REVISION_CONFLICT', 'Queue state changed');
            const record = await visibleRecord(tx, context, command.event_id);
            let receipt: PlaneInboxRetryReceipt;
            try {
              receipt = parsePlaneInboxRetryReceipt(
                {
                  operation: 'plane.inbox.retry',
                  identity,
                  request_key: key,
                  command,
                  previous_status: current.status,
                  previous_error_code: current.last_error_code,
                  previous_attempts: current.attempts,
                  record,
                },
                command,
                identity,
                key,
              );
            } catch {
              throw invalid(context);
            }
            await tx`INSERT INTO wcp_plane_inbox_retries
            (tenant_id, workspace_id, project_id, actor_id, client_id, request_key, event_id,
              request_fingerprint, event_fingerprint, receipt, trace_id)
            VALUES (${identity.tenant_id}, ${identity.workspace_id}, ${identity.project_id}, ${identity.actor_id}, ${identity.client_id},
              ${key}, ${command.event_id}, ${requestFingerprint}, ${row.event_fingerprint}, ${JSON.stringify(receipt)}::jsonb, ${context.trace_id})`;
            await tx`INSERT INTO wcp_audit_records
            (audit_id, tenant_id, workspace_id, project_id, actor_id, client_id, action, resource,
              result, classification, details, trace_id, source_refs, occurred_at)
            VALUES (${createUlid()}, ${identity.tenant_id}, ${identity.workspace_id}, ${identity.project_id}, ${identity.actor_id}, ${identity.client_id},
              'plane.inbox.retry.scheduled', ${`plane-event:${command.event_id}`}, 'allowed', ${record.classification},
              ${JSON.stringify({
                event_id: command.event_id,
                reason: command.reason,
                previous_status: current.status,
                previous_error_code: current.last_error_code,
                expected_revision: command.expected_revision,
                revision: record.revision,
              })}::jsonb,
              ${context.trace_id}, '[]'::jsonb, statement_timestamp())`;
            return receipt;
          });
        } catch (error) {
          if (error instanceof ContractError) throw error;
          // A connection failure may follow a commit. Query the same key before deciding to submit again.
          throw unavailable(context);
        }
        return { schema_version: 1, trace_id: context.trace_id, source_refs: [], data };
      },
    );
  }
}

async function visibleRecord(tx: RuntimeSql, context: RequestContext, eventId: string) {
  const [row] = await tx.unsafe<Record<string, unknown>[]>(
    planeInboxVisibleRows + ' AND event_id = $5 LIMIT 1',
    [
      context.tenant_id,
      context.workspace_id,
      context.project_id,
      context.capability.includes('data.restricted.read'),
      eventId,
    ],
  );
  if (!row) throw missing(context);
  try {
    return planeInboxMetadata(row, context);
  } catch {
    throw invalid(context);
  }
}
function failure(context: RequestContext, code: string, message: string) {
  return new ContractError(code, message, { trace_id: context.trace_id });
}
function missing(context: RequestContext) {
  return failure(context, 'NOT_FOUND', 'Event receipt is unavailable in this project');
}
function invalid(context: RequestContext) {
  return failure(context, 'PLANE_INBOX_INVALID', 'Saved event or retry receipt is inconsistent');
}
function unavailable(context: RequestContext) {
  return new ContractError(
    'PLANE_INBOX_UNAVAILABLE',
    'Retry storage is unavailable; query the original request receipt before submitting again',
    { trace_id: context.trace_id, retryable: true },
  );
}
