import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ContractError,
  parseSyncCursorQuery,
  SYNC_CURSOR_REQUEST_BYTES,
  syncJsonSnapshot,
  type SyncCommandIdentity,
} from '@planemem/contracts';
import type {
  SqliteSyncInbox,
  SyncInboxApplicationQuery,
  SyncInboxApplicationRestoreQuery,
  SyncInboxApplicationRestoreReceiptCatalogQuery,
  SyncInboxApplicationCatalogQuery,
  SyncInboxApplicationApplyQuery,
  SyncInboxApplicationAuditQuery,
  SyncInboxApplicationReplayQuery,
  SyncInboxApplicationHistoryQuery,
  SyncInboxApplicationSnapshotQuery,
  SyncInboxConsumersQuery,
  SyncInboxPageAuditQuery,
  SyncInboxPageDetailQuery,
  SyncInboxPageHistoryQuery,
} from '@planemem/context-bridge';
import { readBoundedArtifactFile } from './artifact-files.js';
import { runInboxApplicationRestoreReceiptGet } from './inbox-application-restore-receipt-get.js';
import { readSyncPageFile, prepareSyncPageOutput, saveSyncPageArchive } from './sync-page-file.js';

export function isInboxCommand(command: string) {
  return [
    'inbox init',
    'inbox import',
    'inbox status',
    'inbox consumers',
    'inbox audit-pages',
    'inbox page-history',
    'inbox page-get',
    'inbox head',
    'inbox enable-applications',
    'inbox enable-application-restore-receipts',
    'inbox application-restore-receipt',
    'inbox application-restore-receipt-get',
    'inbox application-restore-receipt-list',
    'inbox application-status',
    'inbox application-list',
    'inbox application-apply',
    'inbox application-audit',
    'inbox application-replay',
    'inbox application-history',
    'inbox application-get',
    'inbox enable-ack',
    'inbox enable-ack-dispatch',
    'inbox enable-ack-recovery',
    'inbox ack-status',
    'inbox ack-dispatch-status',
  ].includes(command);
}
function invalid(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use local inbox init/import/status/consumers/audit-pages/page-history/page-get/head/enable-applications/enable-application-restore-receipts/application-restore-receipt/application-restore-receipt-get/application-restore-receipt-list/application-list/application-status/application-apply/application-audit/application-replay/application-history/application-get/enable-ack/enable-ack-dispatch/enable-ack-recovery/ack-status/ack-dispatch-status with --inbox FILE. Init and enable commands accept only --inbox. Import requires --page-file. Reads and application-apply require --json or --json-file: consumers accepts {} or limit/after_consumer_key; other queries require expected_identity and selection parameters. Application-restore-receipt requires the complete original restore query including restore_request_id and never reads an archive. Application-restore-receipt-get requires only original expected_identity/application/restore_request_id and optional read timeout_ms; --output optionally saves its recorded original query to a new file. Application-restore-receipt-list requires original expected_identity/application with optional limit (1–50), after_request_id and read timeout_ms, and accepts no output. Application-list requires only original expected_identity and optional limit/after_application_key/timeout_ms; other application reads require application name/version; history accepts limit and saved sequence/page/projection boundaries; get requires document_sha256 with optional expected_projection_sha256; application-apply selects context-item-lifecycle/1 and also requires document_sha256 and expected_previous_sha256 (root null). Application queries permit timeout_ms in JSON; application-audit also permits max_pages/max_events/max_bytes and never executes reducers; application-replay selects context-item-lifecycle/1, adds max_replay_bytes and recomputes saved history without writing. Head requires --output NEW_PAGE; page-get optionally exports to --output NEW_PAGE. No stdin, key, --timeout-ms or repeated options',
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
        json: { type: 'string' },
        'json-file': { type: 'string' },
        output: { type: 'string' },
      },
    });
    const command = args.positionals.join(' ');
    const path = args.values.inbox;
    const file = args.values['page-file'];
    const json = args.values.json;
    const jsonFile = args.values['json-file'];
    const output = args.values.output;
    const seen = new Set<string>();
    for (const token of args.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    if (
      !isInboxCommand(command) ||
      args.positionals.length !== 2 ||
      !path?.trim() ||
      path === ':memory:' ||
      path === '-' ||
      [file, jsonFile, output].some(
        (value) => value !== undefined && (!value.trim() || value === '-'),
      ) ||
      json === '-'
    )
      throw new TypeError();
    if (
      command === 'inbox init' ||
      command === 'inbox enable-applications' ||
      command === 'inbox enable-application-restore-receipts' ||
      command === 'inbox enable-ack' ||
      command === 'inbox enable-ack-dispatch' ||
      command === 'inbox enable-ack-recovery'
        ? seen.size !== 1
        : command === 'inbox import'
          ? file === undefined || seen.size !== 2
          : file !== undefined ||
            (json === undefined) === (jsonFile === undefined) ||
            (command === 'inbox head' && output === undefined) ||
            (command !== 'inbox head' &&
              command !== 'inbox page-get' &&
              command !== 'inbox application-restore-receipt-get' &&
              output !== undefined)
    )
      throw new TypeError();
    return { command, path: resolve(path), file, json, jsonFile, output };
  } catch {
    throw invalid(trace);
  }
}
async function readQuery(args: ReturnType<typeof argumentsFor>, trace: string): Promise<unknown> {
  let raw = args.json;
  if (args.jsonFile !== undefined) {
    let bytes;
    try {
      bytes = await readBoundedArtifactFile(args.jsonFile, SYNC_CURSOR_REQUEST_BYTES, trace);
    } catch {
      throw new ContractError(
        'INBOX_IDENTITY_FILE_UNAVAILABLE',
        'Read a stable regular inbox query file within 16 KiB',
        {
          trace_id: trace,
          retryable: false,
          acknowledgement_dispatch_state: 'not-sent',
        },
      );
    }
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    } catch {
      throw invalid(trace);
    }
  }
  try {
    if (raw === undefined || Buffer.byteLength(raw, 'utf8') > SYNC_CURSOR_REQUEST_BYTES)
      throw new TypeError();
    return JSON.parse(raw);
  } catch {
    throw invalid(trace);
  }
}
async function readIdentity(
  args: ReturnType<typeof argumentsFor>,
  trace: string,
): Promise<SyncCommandIdentity> {
  const input = await readQuery(args, trace);
  try {
    const query = parseSyncCursorQuery(input);
    if (!query.expected_identity) throw new TypeError();
    return query.expected_identity;
  } catch {
    throw invalid(trace);
  }
}
function envelope(trace: string, data: unknown, identity?: SyncCommandIdentity) {
  return {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: [],
    scope: identity
      ? {
          tenant_id: identity.tenant_id,
          workspace_id: identity.workspace_id,
          project_id: identity.project_id,
        }
      : null,
    data,
  };
}
/** Explicit local commands: they never need a gateway, token, or current account. */
export async function runInboxArguments(argv: string[], trace: string) {
  const args = argumentsFor(argv, trace);
  if (args.command === 'inbox application-restore-receipt-get')
    return runInboxApplicationRestoreReceiptGet(
      args.path,
      await readQuery(args, trace),
      trace,
      args.output,
    );
  const page =
    args.command === 'inbox import' ? await readSyncPageFile(args.file!, trace) : undefined;
  let identity =
    args.command === 'inbox status' ||
    args.command === 'inbox head' ||
    args.command === 'inbox ack-status' ||
    args.command === 'inbox ack-dispatch-status'
      ? await readIdentity(args, trace)
      : undefined;
  const queryInput = [
    'inbox application-restore-receipt-list',
    'inbox application-restore-receipt',
    'inbox application-list',
    'inbox application-replay',
    'inbox application-history',
    'inbox application-get',
    'inbox application-audit',
    'inbox application-status',
    'inbox application-apply',
    'inbox consumers',
    'inbox audit-pages',
    'inbox page-history',
    'inbox page-get',
  ].includes(args.command)
    ? await readQuery(args, trace)
    : undefined;
  let auditQuery: SyncInboxPageAuditQuery | undefined;
  let consumersQuery: SyncInboxConsumersQuery | undefined;
  let historyQuery: SyncInboxPageHistoryQuery | undefined;
  let detailQuery: SyncInboxPageDetailQuery | undefined;
  let applicationQuery: SyncInboxApplicationQuery | undefined;
  let applicationRestoreReceiptQuery: SyncInboxApplicationRestoreQuery | undefined;
  let applicationRestoreReceiptCatalogQuery:
    | SyncInboxApplicationRestoreReceiptCatalogQuery
    | undefined;
  let applicationCatalogQuery: SyncInboxApplicationCatalogQuery | undefined;
  let applicationApplyQuery: SyncInboxApplicationApplyQuery | undefined;
  let applicationAuditQuery: SyncInboxApplicationAuditQuery | undefined;
  let applicationReplayQuery: SyncInboxApplicationReplayQuery | undefined;
  let applicationHistoryQuery: SyncInboxApplicationHistoryQuery | undefined;
  let applicationSnapshotQuery: SyncInboxApplicationSnapshotQuery | undefined;
  const output =
    args.output === undefined ? undefined : await prepareSyncPageOutput(args.output, trace);
  let inbox: SqliteSyncInbox;
  try {
    const bridge = await import('@planemem/context-bridge');
    if (args.command === 'inbox application-restore-receipt-list') {
      applicationRestoreReceiptCatalogQuery =
        bridge.parseInboxApplicationRestoreReceiptCatalogQuery(queryInput, trace);
      identity = applicationRestoreReceiptCatalogQuery.expected_identity;
    } else if (args.command === 'inbox application-restore-receipt') {
      applicationRestoreReceiptQuery = bridge.parseInboxApplicationRestoreReceiptQuery(
        queryInput,
        trace,
      );
      identity = applicationRestoreReceiptQuery.expected_identity;
    } else if (args.command === 'inbox application-list') {
      applicationCatalogQuery = bridge.parseInboxApplicationCatalogQuery(queryInput, trace);
      identity = applicationCatalogQuery.expected_identity;
    } else if (args.command === 'inbox application-replay') {
      applicationReplayQuery = bridge.parseInboxBuiltInApplicationReplayQuery(queryInput, trace);
      identity = applicationReplayQuery.expected_identity;
    } else if (args.command === 'inbox application-history') {
      applicationHistoryQuery = bridge.parseInboxApplicationHistoryQuery(queryInput, trace);
      identity = applicationHistoryQuery.expected_identity;
    } else if (args.command === 'inbox application-get') {
      applicationSnapshotQuery = bridge.parseInboxApplicationSnapshotQuery(queryInput, trace);
      identity = applicationSnapshotQuery.expected_identity;
    } else if (args.command === 'inbox application-audit') {
      applicationAuditQuery = bridge.parseInboxApplicationAuditQuery(queryInput, trace);
      identity = applicationAuditQuery.expected_identity;
    } else if (args.command === 'inbox application-apply') {
      applicationApplyQuery = bridge.parseInboxBuiltInApplicationApplyQuery(queryInput, trace);
      identity = applicationApplyQuery.expected_identity;
    } else if (args.command === 'inbox application-status') {
      applicationQuery = bridge.parseInboxApplicationQuery(queryInput, trace);
      identity = applicationQuery.expected_identity;
    } else if (args.command === 'inbox consumers') {
      consumersQuery = bridge.parseInboxConsumersQuery(queryInput, trace);
    } else if (args.command === 'inbox audit-pages') {
      auditQuery = bridge.parseInboxPageAuditQuery(queryInput, trace);
      identity = auditQuery.expected_identity;
    } else if (args.command === 'inbox page-history') {
      historyQuery = bridge.parseInboxPageHistoryQuery(queryInput, trace);
      identity = historyQuery.expected_identity;
    } else if (args.command === 'inbox page-get') {
      detailQuery = bridge.parseInboxPageDetailQuery(queryInput, trace);
      identity = detailQuery.expected_identity;
    }
    inbox = new bridge.SqliteSyncInbox(args.path, {
      create: args.command === 'inbox init',
      readonly:
        args.command === 'inbox application-restore-receipt-list' ||
        args.command === 'inbox application-restore-receipt' ||
        args.command === 'inbox application-list' ||
        args.command === 'inbox application-replay' ||
        args.command === 'inbox application-history' ||
        args.command === 'inbox application-get' ||
        args.command === 'inbox application-audit' ||
        args.command === 'inbox application-status' ||
        args.command === 'inbox consumers' ||
        args.command === 'inbox status' ||
        args.command === 'inbox audit-pages' ||
        args.command === 'inbox page-history' ||
        args.command === 'inbox page-get' ||
        args.command === 'inbox head' ||
        args.command === 'inbox ack-status' ||
        args.command === 'inbox ack-dispatch-status',
      trace_id: trace,
    });
  } catch (error) {
    if (applicationRestoreReceiptCatalogQuery) {
      throw new ContractError(
        error instanceof ContractError ? error.envelope.code : 'INBOX_STORAGE_UNAVAILABLE',
        error instanceof ContractError
          ? error.envelope.message
          : 'The existing inbox could not be opened for reading',
        {
          trace_id: trace,
          retryable: false,
          details: {
            ...(error instanceof ContractError ? error.envelope.details : {}),
            catalog_query: applicationRestoreReceiptCatalogQuery,
            catalog_completed: false,
            inbox: args.path,
            local_write_state: 'not-performed',
            acknowledgement_dispatch_state: 'not-sent',
          },
        },
      );
    }
    if (error instanceof ContractError) {
      if (!applicationRestoreReceiptQuery) throw error;
      throw new ContractError(error.envelope.code, error.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: {
          ...error.envelope.details,
          restore_query: applicationRestoreReceiptQuery,
          inbox: args.path,
          local_write_state: 'not-performed',
          acknowledgement_dispatch_state: 'not-sent',
        },
      });
    }
    throw new ContractError('INBOX_STORAGE_UNAVAILABLE', 'The local inbox could not be opened', {
      trace_id: trace,
      retryable: false,
      details: {
        acknowledgement_dispatch_state: 'not-sent',
        ...(applicationRestoreReceiptQuery
          ? {
              restore_query: applicationRestoreReceiptQuery,
              inbox: args.path,
              local_write_state: 'not-performed',
            }
          : {}),
      },
    });
  }
  let result;
  let exportedPage;
  let selectedSequence: number | undefined;
  try {
    if (args.command === 'inbox init') {
      result = envelope(trace, {
        status: 'initialized',
        schema_version: 1,
        inbox: args.path,
        local_commit_state: 'committed',
        acknowledgement_dispatch_state: 'not-sent',
      });
    } else if (args.command === 'inbox enable-applications') {
      result = envelope(trace, {
        ...inbox.enableApplications(trace),
        inbox: args.path,
        local_commit_state: 'committed',
        acknowledgement_dispatch_state: 'not-sent',
      });
    } else if (args.command === 'inbox enable-application-restore-receipts') {
      result = envelope(trace, {
        ...inbox.enableApplicationRestoreReceipts(trace),
        inbox: args.path,
        local_commit_state: 'committed',
        acknowledgement_dispatch_state: 'not-sent',
      });
    } else if (applicationRestoreReceiptCatalogQuery) {
      result = envelope(
        trace,
        {
          ...inbox.listApplicationRestoreReceipts(applicationRestoreReceiptCatalogQuery, trace),
          inbox: args.path,
        },
        applicationRestoreReceiptCatalogQuery.expected_identity,
      );
    } else if (applicationRestoreReceiptQuery) {
      result = envelope(
        trace,
        {
          ...inbox.readApplicationRestoreReceipt(applicationRestoreReceiptQuery, trace),
          inbox: args.path,
        },
        applicationRestoreReceiptQuery.expected_identity,
      );
    } else if (applicationCatalogQuery) {
      result = envelope(
        trace,
        { ...inbox.readApplicationCatalog(applicationCatalogQuery, trace), inbox: args.path },
        applicationCatalogQuery.expected_identity,
      );
    } else if (applicationReplayQuery) {
      result = envelope(
        trace,
        {
          ...inbox.replayBuiltInApplicationHistory(applicationReplayQuery, trace),
          inbox: args.path,
        },
        applicationReplayQuery.expected_identity,
      );
    } else if (applicationHistoryQuery) {
      result = envelope(
        trace,
        { ...inbox.readApplicationHistory(applicationHistoryQuery, trace), inbox: args.path },
        applicationHistoryQuery.expected_identity,
      );
    } else if (applicationSnapshotQuery) {
      result = envelope(
        trace,
        { ...inbox.readApplicationSnapshot(applicationSnapshotQuery, trace), inbox: args.path },
        applicationSnapshotQuery.expected_identity,
      );
    } else if (applicationAuditQuery) {
      result = envelope(
        trace,
        { ...inbox.auditApplicationHistory(applicationAuditQuery, trace), inbox: args.path },
        applicationAuditQuery.expected_identity,
      );
    } else if (applicationApplyQuery) {
      result = envelope(
        trace,
        {
          ...inbox.applyBuiltInApplicationPage(applicationApplyQuery, trace),
          inbox: args.path,
          local_commit_state: 'committed',
          acknowledgement_dispatch_state: 'not-sent',
        },
        applicationApplyQuery.expected_identity,
      );
    } else if (applicationQuery) {
      result = envelope(
        trace,
        { state: inbox.readApplicationState(applicationQuery, trace), inbox: args.path },
        applicationQuery.expected_identity,
      );
    } else if (
      args.command === 'inbox enable-ack' ||
      args.command === 'inbox enable-ack-dispatch' ||
      args.command === 'inbox enable-ack-recovery'
    ) {
      result = envelope(trace, {
        ...(args.command === 'inbox enable-ack'
          ? inbox.enableAcknowledgements(trace)
          : args.command === 'inbox enable-ack-dispatch'
            ? inbox.enableAcknowledgementDispatches(trace)
            : inbox.enableAcknowledgementRecoveries(trace)),
        inbox: args.path,
        local_commit_state: 'committed',
        acknowledgement_dispatch_state: 'not-sent',
      });
    } else if (args.command === 'inbox ack-dispatch-status' && identity) {
      result = envelope(
        trace,
        {
          ...inbox.readAcknowledgementDispatch(identity, trace),
          inbox: args.path,
          acknowledgement_dispatch_state: 'not-sent',
        },
        identity,
      );
    } else if (args.command === 'inbox ack-status' && identity) {
      result = envelope(
        trace,
        {
          record: inbox.readAcknowledgement(identity, trace),
          inbox: args.path,
          acknowledgement_dispatch_state: 'not-sent',
        },
        identity,
      );
    } else if (page) {
      const imported = inbox.importPage(
        { document: page.document, document_sha256: page.document_sha256 },
        trace,
      );
      result = envelope(
        trace,
        {
          ...imported,
          inbox: args.path,
          local_commit_state: 'committed',
          acknowledgement_dispatch_state: 'not-sent',
        },
        page.document.expected_identity,
      );
    } else if (consumersQuery) {
      result = envelope(trace, {
        ...inbox.listConsumers(consumersQuery, trace),
        inbox: args.path,
        acknowledgement_dispatch_state: 'not-sent',
        event_application: 'not-verified',
      });
    } else if (historyQuery) {
      result = envelope(
        trace,
        {
          ...inbox.readPageHistory(historyQuery, trace),
          inbox: args.path,
          acknowledgement_dispatch_state: 'not-sent',
          event_application: 'not-verified',
        },
        historyQuery.expected_identity,
      );
    } else if (detailQuery) {
      const detail = inbox.readPageByDigest(detailQuery, trace);
      if (output) {
        if (!detail.page)
          throw new ContractError(
            'INBOX_PAGE_NOT_FOUND',
            'The selected page is absent for this original consumer; no file was produced',
            {
              trace_id: trace,
              retryable: false,
              acknowledgement_dispatch_state: 'not-sent',
            },
          );
        exportedPage = detail.page;
        selectedSequence = detail.summary?.sequence;
      } else
        result = envelope(
          trace,
          {
            ...detail,
            inbox: args.path,
            acknowledgement_dispatch_state: 'not-sent',
            event_application: 'not-verified',
          },
          detailQuery.expected_identity,
        );
    } else if (auditQuery) {
      result = envelope(
        trace,
        { ...inbox.auditPages(auditQuery, trace), inbox: args.path },
        auditQuery.expected_identity,
      );
    } else if (args.command === 'inbox status' && identity) {
      result = envelope(
        trace,
        {
          inbox: args.path,
          state: inbox.inspect(identity, trace),
          acknowledgement_dispatch_state: 'not-sent',
        },
        identity,
      );
    } else if (identity && output) {
      exportedPage = inbox.readHead(identity, trace);
    } else throw invalid(trace);
  } catch (error) {
    let close_pending = false;
    try {
      inbox.close();
    } catch {
      /* Preserve the original error or commit uncertainty. */
      close_pending = true;
    }
    if (
      [
        'inbox consumers',
        'inbox audit-pages',
        'inbox page-history',
        'inbox page-get',
        'inbox enable-applications',
        'inbox enable-application-restore-receipts',
        'inbox application-restore-receipt',
        'inbox application-restore-receipt-list',
        'inbox application-status',
        'inbox application-list',
        'inbox application-apply',
        'inbox application-audit',
        'inbox application-replay',
        'inbox application-history',
        'inbox application-get',
      ].includes(args.command) &&
      error instanceof ContractError
    )
      throw new ContractError(error.envelope.code, error.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: {
          ...error.envelope.details,
          inbox: args.path,
          ...(applicationRestoreReceiptCatalogQuery
            ? {
                catalog_query: applicationRestoreReceiptCatalogQuery,
                catalog_completed: false,
                local_write_state: 'not-performed',
              }
            : {}),
          ...(applicationRestoreReceiptQuery
            ? { restore_query: applicationRestoreReceiptQuery, local_write_state: 'not-performed' }
            : {}),
          ...(applicationApplyQuery
            ? {
                expected_identity: applicationApplyQuery.expected_identity,
                application: applicationApplyQuery.application,
                document_sha256: applicationApplyQuery.document_sha256,
                expected_previous_sha256: applicationApplyQuery.expected_previous_sha256,
              }
            : {}),
          ...(args.command === 'inbox audit-pages'
            ? { audit_scope: 'consumer-page-chain', audit_completed: false }
            : {}),
          close_pending,
          acknowledgement_dispatch_state: 'not-sent',
        },
      });
    throw error;
  }
  let close_pending = false;
  try {
    inbox.close();
  } catch {
    close_pending = true;
  }
  if (exportedPage && output) {
    // File work happens after releasing the read transaction and database connection.
    try {
      const saved = await saveSyncPageArchive(exportedPage, output, trace);
      return {
        ...saved,
        data: {
          ...saved.data,
          inbox: args.path,
          close_pending,
          ...(selectedSequence === undefined
            ? {}
            : { selected_sequence: selectedSequence, full_chain_audit: 'not-performed' }),
        },
      };
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      throw new ContractError(error.envelope.code, error.envelope.message, {
        trace_id: trace,
        retryable: false,
        details: { ...error.envelope.details, inbox: args.path, close_pending },
      });
    }
  }
  if (!result) throw invalid(trace);
  if (applicationRestoreReceiptCatalogQuery) {
    try {
      syncJsonSnapshot({ ...result, close_pending }, 512 * 1024);
    } catch {
      throw new ContractError(
        'INBOX_APPLICATION_RESTORE_RECEIPT_CATALOG_TOO_LARGE',
        'The complete restore receipt catalog response exceeds 512 KiB; request a smaller limit',
        {
          trace_id: trace,
          retryable: false,
          details: {
            catalog_query: applicationRestoreReceiptCatalogQuery,
            catalog_completed: true,
            response_completed: false,
            inbox: args.path,
            close_pending,
            local_write_state: 'not-performed',
            acknowledgement_dispatch_state: 'not-sent',
          },
        },
      );
    }
  }
  return { ...result, close_pending };
}
