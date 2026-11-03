import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ContractError,
  type SyncCommandIdentity,
  type SyncAckEvidenceDocument,
} from '@planemem/contracts';
import type { SqliteSyncInbox } from '@planemem/context-bridge';
import { readBoundedArtifactFile } from './artifact-files.js';
import { prepareSyncAckEvidenceOutput, saveSyncAckEvidence } from './inbox-ack-evidence-file.js';
import type { ArtifactOutput } from './artifact-output.js';

export function isInboxAckHistoryCommand(command: string) {
  return [
    'inbox ack-history',
    'inbox ack-audit',
    'inbox ack-get',
    'inbox ack-dispatch-history',
    'inbox ack-dispatch-get',
    'inbox ack-recovery-get',
  ].includes(command);
}
function invalid(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use inbox ack-audit/ack-history/ack-get/ack-dispatch-history/ack-dispatch-get/ack-recovery-get with --inbox EXISTING_FILE and exactly one --json or --json-file containing the original expected_identity and command selection. Ack-audit accepts optional max_entries. Only the three get commands accept --output NEW_EVIDENCE_FILE; recovery export uses archive v2. No stdin or extra/repeated options',
    { trace_id: trace, retryable: false, acknowledgement_dispatch_state: 'not-sent' },
  );
}
function localFailure(error: unknown, trace: string) {
  return new ContractError(
    error instanceof ContractError ? error.envelope.code : 'INBOX_ACK_HISTORY_UNAVAILABLE',
    error instanceof ContractError
      ? error.envelope.message
      : 'The selected local history could not be read completely',
    {
      trace_id: trace,
      retryable: false,
      details: {
        ...(error instanceof ContractError ? error.envelope.details : {}),
        acknowledgement_dispatch_state: 'not-sent',
      },
    },
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
        json: { type: 'string' },
        'json-file': { type: 'string' },
        output: { type: 'string' },
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
    const json = args.values.json;
    const file = args.values['json-file'];
    const output = args.values.output;
    if (
      args.positionals.length !== 2 ||
      !isInboxAckHistoryCommand(command) ||
      !path?.trim() ||
      path === '-' ||
      path === ':memory:' ||
      (json === undefined) === (file === undefined) ||
      json === '-' ||
      (file !== undefined && (!file.trim() || file === '-'))
    )
      throw new TypeError();
    if (
      output !== undefined &&
      (!output.trim() ||
        output === '-' ||
        (command !== 'inbox ack-get' &&
          command !== 'inbox ack-dispatch-get' &&
          command !== 'inbox ack-recovery-get'))
    )
      throw new TypeError();
    return { command, path: resolve(path), json, file, output };
  } catch {
    throw invalid(trace);
  }
}
async function readQuery(args: ReturnType<typeof argumentsFor>, trace: string): Promise<unknown> {
  let raw = args.json;
  if (args.file !== undefined) {
    try {
      const bytes = await readBoundedArtifactFile(args.file, 16384, trace);
      raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    } catch {
      throw new ContractError(
        'INBOX_ACK_HISTORY_FILE_UNAVAILABLE',
        'Read a stable regular UTF-8 history query file within 16 KiB',
        { trace_id: trace, retryable: false, acknowledgement_dispatch_state: 'not-sent' },
      );
    }
  }
  try {
    if (raw === undefined || Buffer.byteLength(raw, 'utf8') > 16384) throw new TypeError();
    return JSON.parse(raw);
  } catch {
    throw invalid(trace);
  }
}
/** Local inspection only; no transport, token, mutation or implicit extension activation. */
export async function runInboxAckHistoryArguments(argv: string[], trace: string) {
  const args = argumentsFor(argv, trace);
  const input = await readQuery(args, trace);
  const audit = args.command === 'inbox ack-audit';
  const dispatch =
    args.command === 'inbox ack-dispatch-history' || args.command === 'inbox ack-dispatch-get';
  const history =
    args.command === 'inbox ack-history' || args.command === 'inbox ack-dispatch-history';
  let inbox: SqliteSyncInbox;
  let identity: SyncCommandIdentity;
  let output: ArtifactOutput | undefined;
  try {
    const bridge = await import('@planemem/context-bridge');
    const checked = audit
      ? bridge.parseInboxAckAuditQuery(input, trace)
      : history
        ? bridge.parseInboxAckHistoryQuery(input, trace, dispatch)
        : bridge.parseInboxAckDetailQuery(input, trace, dispatch);
    identity = checked.expected_identity;
    output =
      args.output === undefined
        ? undefined
        : await prepareSyncAckEvidenceOutput(args.output, trace);
    inbox = new bridge.SqliteSyncInbox(args.path, { readonly: true, trace_id: trace });
  } catch (error) {
    if (error instanceof ContractError) throw localFailure(error, trace);
    throw new ContractError(
      'INBOX_STORAGE_UNAVAILABLE',
      'The existing inbox could not be opened for local history reading',
      { trace_id: trace, retryable: false, acknowledgement_dispatch_state: 'not-sent' },
    );
  }
  let result;
  let document: SyncAckEvidenceDocument | undefined;
  try {
    if (output) {
      document =
        args.command === 'inbox ack-recovery-get'
          ? inbox.readAcknowledgementRecoveryEvidence(input, trace)
          : dispatch
            ? inbox.readAcknowledgementDispatchEvidence(input, trace)
            : inbox.readAcknowledgementEvidence(input, trace);
    } else if (audit) {
      result = inbox.auditAcknowledgements(input, trace);
    } else if (args.command === 'inbox ack-recovery-get') {
      result = inbox.readAcknowledgementRecovery(input, trace);
    } else
      result = history
        ? dispatch
          ? inbox.readAcknowledgementDispatchHistory(input, trace)
          : inbox.readAcknowledgementHistory(input, trace)
        : dispatch
          ? inbox.readAcknowledgementDispatchById(input, trace)
          : inbox.readAcknowledgementById(input, trace);
  } catch (error) {
    let close_pending = false;
    try {
      inbox.close();
    } catch {
      /* Keep the original read failure. */
      close_pending = true;
    }
    const failure = localFailure(error, trace);
    throw new ContractError(failure.envelope.code, failure.envelope.message, {
      trace_id: trace,
      retryable: false,
      details: {
        ...failure.envelope.details,
        inbox: args.path,
        close_pending,
        ...(audit
          ? { audit_completed: false, audit_scope: 'consumer-acknowledgement-journals' }
          : {}),
      },
    });
  }
  let close_pending = false;
  try {
    inbox.close();
  } catch {
    close_pending = true;
  }
  if (document && output) {
    try {
      const saved = await saveSyncAckEvidence(document, output, trace);
      return { ...saved, data: { ...saved.data, inbox: args.path, close_pending } };
    } catch (error) {
      const failure = localFailure(error, trace);
      throw new ContractError(failure.envelope.code, failure.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: { ...failure.envelope.details, inbox: args.path, close_pending },
      });
    }
  }
  if (!result) throw localFailure(undefined, trace);
  return {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: [],
    scope: {
      tenant_id: identity.tenant_id,
      workspace_id: identity.workspace_id,
      project_id: identity.project_id,
    },
    data: {
      ...result,
      inbox: args.path,
      close_pending,
      acknowledgement_dispatch_state: 'not-sent' as const,
      event_application: 'not-verified' as const,
    },
  };
}
