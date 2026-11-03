import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ContractError,
  isUlid,
  assertSyncCommandIdentity,
  parseSyncAcknowledgementEnvelope,
  parseSyncCursorEnvelope,
  type SyncCommandIdentity,
  type SyncAcknowledgement,
  type SyncAcknowledgementEnvelope,
  type SyncCursorEnvelope,
} from '@planemem/contracts';
import { WcpClient, FetchWcpTransport } from '@planemem/sdk';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';
import type {
  SqliteSyncInbox,
  SyncInboxAcknowledgement,
  SyncInboxAcknowledgementDispatch,
  SyncInboxAcknowledgementRecovery,
} from '@planemem/context-bridge';
import { readSyncPageFile } from './sync-page-file.js';
import { runSyncConsumer } from './sync-consumer.js';
import { captureSyncAckResult, prepareSyncAckResultOutput } from './inbox-ack-result-file.js';

type Scope = { tenant_id: string; workspace_id: string; project_id: string };
export function isInboxAcknowledgementCommand(command: string) {
  return (
    command === 'inbox ack' ||
    command === 'inbox ack-retry' ||
    command === 'inbox ack-observe' ||
    command === 'inbox ack-recover'
  );
}
function invalid(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use inbox ack/ack-retry/ack-observe/ack-recover with --inbox EXISTING_FILE --page-file ORIGINAL_PAGE and optional --timeout-ms/--result-output NEW_FILE; ack-retry requires --dispatch-id LATEST_ID; ack-recover requires --record-id ORIGINAL_ID and sends the legacy original target. No JSON, key, output, stdin or repeated options',
    { trace_id: trace, retryable: false, acknowledgement_dispatch_state: 'not-sent' },
  );
}
function argumentsFor(argv: string[], trace: string) {
  try {
    const args = parseArgs({
      args: [...argv],
      tokens: true,
      allowPositionals: true,
      options: {
        inbox: { type: 'string' },
        'page-file': { type: 'string' },
        'timeout-ms': { type: 'string' },
        'dispatch-id': { type: 'string' },
        'record-id': { type: 'string' },
        'result-output': { type: 'string' },
      },
    });
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const command = args.positionals.join(' ');
    const path = args.values.inbox;
    const file = args.values['page-file'];
    const timeout = args.values['timeout-ms'] ?? '30000';
    const dispatchId = args.values['dispatch-id'];
    const recordId = args.values['record-id'];
    const resultOutput = args.values['result-output'];
    if (
      args.positionals.length !== 2 ||
      !isInboxAcknowledgementCommand(command) ||
      !path?.trim() ||
      path === ':memory:' ||
      path === '-' ||
      !file?.trim() ||
      file === '-' ||
      !/^[1-9][0-9]{0,9}$/.test(timeout) ||
      Number(timeout) > 2147483647
    )
      throw new TypeError();
    if (command === 'inbox ack-retry' ? !isUlid(dispatchId) : dispatchId !== undefined)
      throw new TypeError();
    if (command === 'inbox ack-recover' ? !isUlid(recordId) : recordId !== undefined)
      throw new TypeError();
    if (resultOutput !== undefined && (!resultOutput.trim() || resultOutput === '-'))
      throw new TypeError();
    return {
      command,
      path: resolve(path),
      file,
      timeout_ms: Number(timeout),
      dispatchId,
      recordId,
      resultOutput,
    };
  } catch {
    throw invalid(trace);
  }
}
interface Calls {
  validateIdentity(identity: SyncCommandIdentity): void;
  ack(command: SyncAcknowledgement, requestTrace: string): Promise<unknown>;
  cursor(identity: SyncCommandIdentity): Promise<unknown>;
}
async function execute(
  args: ReturnType<typeof argumentsFor>,
  scope: Scope,
  trace: string,
  calls: Calls,
) {
  const saved = await readSyncPageFile(args.file, trace, scope);
  const identity = saved.document.expected_identity;
  calls.validateIdentity(identity);
  const resultOutput =
    args.resultOutput === undefined
      ? undefined
      : await prepareSyncAckResultOutput(args.resultOutput, trace);
  let inbox: SqliteSyncInbox;
  try {
    const bridge = await import('@planemem/context-bridge');
    inbox = new bridge.SqliteSyncInbox(args.path, { trace_id: trace });
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError('INBOX_STORAGE_UNAVAILABLE', 'The existing inbox could not be opened', {
      trace_id: trace,
      retryable: false,
      acknowledgement_dispatch_state: 'not-sent',
    });
  }
  let ticket: SyncInboxAcknowledgement | undefined;
  let dispatch: SyncInboxAcknowledgementDispatch | undefined;
  let recovery: SyncInboxAcknowledgementRecovery | null = null;
  let dispatch_settlement_pending = false;
  let dispatch_settlement_commit_state: unknown = null;
  let attempted = false;
  let action: 'already-recorded' | 'confirmation-recorded' | 'observation-recorded' =
    'already-recorded';
  let evidence: SyncAcknowledgementEnvelope | SyncCursorEnvelope | undefined;
  let requestSnapshot:
    | { record: SyncInboxAcknowledgement; dispatch: SyncInboxAcknowledgementDispatch | null }
    | undefined;
  async function saveResult(journalUpdate: 'completed' | 'unconfirmed') {
    if (!resultOutput) return undefined;
    if (!evidence)
      return {
        state: 'not-created' as const,
        path: resultOutput.path,
        reason: journalUpdate === 'completed' ? 'no-new-server-result' : 'no-valid-server-result',
      };
    return captureSyncAckResult(
      {
        schema_version: 1,
        kind: 'workctx.sync-ack-result',
        page: { document: saved.document, document_sha256: saved.document_sha256 },
        record_before_request: requestSnapshot?.record,
        dispatch_before_request: requestSnapshot?.dispatch,
        invocation_trace_id: trace,
        server_result_kind:
          args.command === 'inbox ack-observe' ? 'current-cursor' : 'original-acknowledgement',
        server_result: evidence,
        journal_update: journalUpdate,
      },
      resultOutput,
      trace,
    );
  }
  try {
    if (args.command !== 'inbox ack-observe') {
      const prepared =
        args.command === 'inbox ack-recover'
          ? inbox.startAcknowledgementRecovery(
              identity,
              saved.document_sha256,
              args.recordId!,
              trace,
              args.timeout_ms,
            )
          : inbox.startAcknowledgementDispatch(
              identity,
              saved.document_sha256,
              trace,
              args.timeout_ms,
              args.dispatchId,
            );
      ticket = prepared.record;
      recovery = prepared.recovery;
      if (prepared.dispatch) {
        dispatch = prepared.dispatch;
        // Both original target and dispatch ownership are committed before the callback.
        inbox.assertAcknowledgementDispatch(ticket, dispatch, trace);
        if (resultOutput) requestSnapshot = structuredClone({ record: ticket, dispatch });
        attempted = true;
        const raw = await calls.ack(structuredClone(ticket.command), ticket.request_trace_id);
        try {
          evidence = parseSyncAcknowledgementEnvelope(raw, ticket.command, ticket.request_trace_id);
        } catch {
          throw new ContractError(
            'GATEWAY_RESPONSE_INVALID',
            'The complete original acknowledgement response did not match its saved target',
            { trace_id: trace },
          );
        }
        const settled = inbox.settleAcknowledgementDispatch(ticket, dispatch, evidence, trace);
        ticket = settled.record;
        dispatch = settled.dispatch;
        action = 'confirmation-recorded';
      }
    } else {
      const current = inbox.readAcknowledgement(identity, trace);
      if (!current || current.document_sha256 !== saved.document_sha256)
        throw new ContractError(
          'INBOX_ACK_TARGET_MISMATCH',
          'Select the original page for the latest saved acknowledgement; no query was sent',
          { trace_id: trace },
        );
      ticket = current;
      if (ticket.state === 'unconfirmed') {
        if (resultOutput) requestSnapshot = structuredClone({ record: ticket, dispatch: null });
        const raw = await calls.cursor(structuredClone(identity));
        try {
          const parsed = parseSyncCursorEnvelope(raw, identity, trace, identity);
          if (Date.parse(parsed.data.expires_at) <= Date.now()) throw new TypeError();
          evidence = parsed;
        } catch {
          throw new ContractError(
            'GATEWAY_RESPONSE_INVALID',
            'The current cursor observation did not match the original consumer',
            { trace_id: trace },
          );
        }
        ticket = inbox.observeAcknowledgement(ticket, evidence, trace);
        action =
          ticket.observation && JSON.stringify(ticket.observation) === JSON.stringify(evidence)
            ? 'observation-recorded'
            : 'already-recorded';
      }
    }
  } catch (error) {
    if (dispatch && ticket && !evidence) {
      try {
        dispatch = inbox.settleAcknowledgementDispatch(ticket, dispatch, null, trace).dispatch;
      } catch (settlementError) {
        // Leave the durable lease intact if settlement itself is uncertain.
        dispatch_settlement_pending = true;
        dispatch_settlement_commit_state =
          settlementError instanceof ContractError
            ? (settlementError.envelope.details.local_commit_state ?? 'not-committed')
            : 'not-committed';
      }
    }
    let close_pending = false;
    try {
      inbox.close();
    } catch {
      /* Preserve original request evidence or uncertainty. */
      close_pending = true;
    }
    const result_file = await saveResult('unconfirmed');
    if (evidence) {
      throw new ContractError(
        'INBOX_ACK_EVIDENCE_SAVE_FAILED',
        'The complete server result was received but its local journal update was not confirmed; preserve this result and the original page',
        {
          trace_id: trace,
          retryable: false,
          details: {
            inbox: args.path,
            close_pending,
            ...(result_file === undefined ? {} : { result_file }),
            ...(ticket ? { record_id: ticket.record_id } : {}),
            ...(dispatch ? { dispatch } : {}),
            ...(recovery ? { recovery } : {}),
            dispatch_settlement_pending: dispatch !== undefined,
            server_result_kind:
              args.command !== 'inbox ack-observe' ? 'original-acknowledgement' : 'current-cursor',
            server_result: evidence,
            local_commit_state:
              error instanceof ContractError
                ? (error.envelope.details.local_commit_state ?? 'not-committed')
                : 'not-committed',
            acknowledgement_dispatch_state: attempted ? 'confirmed' : 'not-sent',
          },
        },
      );
    }
    const hints: Record<string, unknown> =
      error instanceof ContractError &&
      (error.envelope.code === 'INBOX_ACK_DISPATCH_BUSY' ||
        error.envelope.code === 'INBOX_ACK_RECOVERY_HAS_DISPATCH')
        ? error.envelope.details
        : {};
    throw new ContractError(
      error instanceof ContractError ? error.envelope.code : 'INBOX_ACK_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'The original acknowledgement could not be confirmed; keep its saved journal and page',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(hints.dispatch_id === undefined ? {} : { dispatch_id: hints.dispatch_id }),
          ...(hints.lease_until_ms === undefined ? {} : { lease_until_ms: hints.lease_until_ms }),
          ...(hints.recovery_id === undefined ? {} : { recovery_id: hints.recovery_id }),
          inbox: args.path,
          close_pending,
          ...(result_file === undefined ? {} : { result_file }),
          ...(ticket ? { record_id: ticket.record_id } : {}),
          ...(!ticket && args.recordId ? { record_id: args.recordId } : {}),
          ...(dispatch ? { dispatch } : {}),
          ...(recovery ? { recovery } : {}),
          dispatch_settlement_pending,
          dispatch_settlement_commit_state,
          local_commit_state:
            error instanceof ContractError
              ? (error.envelope.details.local_commit_state ?? 'unchanged')
              : 'unchanged',
          acknowledgement_dispatch_state: attempted ? 'unknown' : 'not-sent',
        },
      },
    );
  }
  let close_pending = false;
  try {
    inbox.close();
  } catch {
    close_pending = true;
  }
  const result_file = await saveResult('completed');
  if (result_file?.state === 'save-failed')
    throw new ContractError(
      'INBOX_ACK_RESULT_SAVE_FAILED',
      'The server result and local journal operation completed, but the requested result file was not confirmed; preserve this output and inspect the reported paths before any further request',
      {
        trace_id: trace,
        retryable: false,
        details: {
          inbox: args.path,
          close_pending,
          action,
          record: ticket,
          dispatch: dispatch ?? null,
          recovery,
          result_file,
          journal_update: 'completed',
          server_result_kind:
            args.command === 'inbox ack-observe' ? 'current-cursor' : 'original-acknowledgement',
          server_result: evidence,
          acknowledgement_dispatch_state: attempted ? 'confirmed' : 'not-sent',
        },
      },
    );
  return {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: [],
    scope: { ...scope },
    data: {
      action,
      record: ticket!,
      dispatch: dispatch ?? null,
      recovery,
      inbox: args.path,
      close_pending,
      ...(result_file === undefined ? {} : { result_file }),
      acknowledgement_dispatch_state: attempted ? ('confirmed' as const) : ('not-sent' as const),
      event_application: 'not-verified' as const,
    },
  };
}
export async function callInboxAcknowledgementArguments(
  argv: string[],
  options: { base: string; token: string; trace: string; scope: Scope },
) {
  const snapshot = structuredClone(options);
  const args = argumentsFor(argv, snapshot.trace);
  let clientFor: (requestTrace: string) => WcpClient;
  try {
    const base = new URL(snapshot.base);
    const token = snapshot.token.trim();
    if (base.hash || base.search || !token) throw new TypeError();
    new Headers({ authorization: 'Bearer ' + token });
    const transport = new FetchWcpTransport({
      base_url: base.href,
      access_token: () => token,
      timeout_ms: args.timeout_ms,
    });
    clientFor = (requestTrace) =>
      new WcpClient(transport, { ...snapshot.scope, trace_id: requestTrace });
  } catch {
    throw invalid(snapshot.trace);
  }
  return execute(args, snapshot.scope, snapshot.trace, {
    validateIdentity() {
      /* Scope is checked by the file reader; Gateway verifies token identity. */
    },
    ack: (command, requestTrace) =>
      clientFor(requestTrace).acknowledgeSync(command.cursor, {
        expected_identity: command.expected_identity,
        timeout_ms: args.timeout_ms,
      }),
    cursor: (identity) =>
      clientFor(snapshot.trace).getSyncCursor({
        expected_identity: identity,
        timeout_ms: args.timeout_ms,
      }),
  });
}
export async function runInboxAcknowledgement(
  argv: string[],
  router: CommandRouter,
  original: RequestContext,
) {
  const context = structuredClone(original);
  const trace = context.trace_id;
  const args = argumentsFor(argv, trace);
  const scope = {
    tenant_id: context.tenant_id,
    workspace_id: context.workspace_id,
    project_id: context.project_id,
  };
  return execute(args, scope, trace, {
    validateIdentity(identity) {
      const expiry = Date.parse(context.token_expires_at ?? '');
      if (
        context.authenticated_client !== true ||
        !Number.isFinite(expiry) ||
        expiry <= Date.now() ||
        (context.roles?.includes('admin') !== true && !context.capability.includes('sync.read'))
      )
        throw new ContractError('DENIED', 'A verified unexpired sync reader is required', {
          trace_id: trace,
          acknowledgement_dispatch_state: 'not-sent',
        });
      try {
        assertSyncCommandIdentity(identity, context);
      } catch {
        throw new ContractError('DENIED', 'Use the original consumer account, client and project', {
          trace_id: trace,
          acknowledgement_dispatch_state: 'not-sent',
        });
      }
      if (
        args.command !== 'inbox ack-observe' &&
        (context.idempotency_key !== undefined || context.expected_version !== undefined)
      )
        throw invalid(trace);
    },
    ack: (command, requestTrace) =>
      runSyncConsumer(
        ['sync', 'ack', '--json', JSON.stringify(command), '--timeout-ms', String(args.timeout_ms)],
        router,
        { ...context, trace_id: requestTrace },
      ),
    cursor: (identity) =>
      runSyncConsumer(
        [
          'sync',
          'cursor',
          '--json',
          JSON.stringify({ expected_identity: identity }),
          '--timeout-ms',
          String(args.timeout_ms),
        ],
        router,
        context,
      ),
  });
}
