import {
  ContractError,
  assertArtifactReceiptIdentity,
  parseArtifactReceiptQuery,
} from '@planemem/contracts';
import { parseArgs } from 'node:util';
import type { CommandRouter, CommandResult, RequestContext } from '@planemem/api-gateway';
import { prepareObservedRead, observedReadResult } from './observed.js';
import { prepareHandoffClaim, handoffClaimResult } from './handoff-claim.js';
import { prepareHandoffCreate, handoffCreateResult } from './handoff-create.js';
import { prepareSessionStart, sessionStartResult } from './session-start.js';
import { prepareSessionState, sessionStateResult } from './session-state.js';
import { prepareHandoffRead, handoffReadResult } from './handoff-read.js';
import {
  prepareCheckpointHistory,
  checkpointHistoryResult,
  checkpointWorkbenchHistoryResult,
} from './checkpoint-history.js';
import { isArtifactReadCommand, prepareArtifactRead, artifactReadResult } from './artifact-read.js';
import { prepareArtifactReceipt, artifactReceiptResult } from './artifact-receipt.js';
import { runArtifactDownload } from './artifact-download.js';
import { isAuditCommand, runAudit } from './audit.js';
import { runAdminSnapshot } from './admin.js';
import { runSessionCommandContext } from './session-command-context.js';
import { runConflictCommandContext } from './conflict-command-context.js';
import { runSyncCommandContext } from './sync-command-context.js';
import { runSyncEventReceipt } from './sync-event-receipt.js';
import { runSyncConsumer, isSyncConsumerCommand } from './sync-consumer.js';
import { inspectSyncPageArguments } from './sync-page-file.js';
import {
  isInboxAckEvidenceCommand,
  runSyncAckEvidenceArguments,
} from './inbox-ack-evidence-file.js';
import { isInboxAckHistoryCommand, runInboxAckHistoryArguments } from './inbox-ack-history.js';
import { isInboxAckResultCommand, runSyncAckResultArguments } from './inbox-ack-result-file.js';
import { isInboxCommand, runInboxArguments } from './inbox.js';
import { isInboxPageChainCommand, runInboxPageChainArguments } from './inbox-page-chain.js';
import {
  isInboxApplicationArchiveCommand,
  runInboxApplicationArchiveArguments,
} from './inbox-application-archive.js';
import { isInboxAcknowledgementCommand, runInboxAcknowledgement } from './inbox-acknowledgement.js';
import { runOutboxReconcile } from './outbox-reconcile.js';
import { inspectOutboxReceiptArguments } from './outbox-receipt-file.js';
import { isOutboxReadCommand, runOutboxReadArguments } from './outbox-read.js';
import { runConflictSubmission } from './conflict-submission.js';
import { runConflictPreparation } from './conflict-preparation.js';
import { runSessionRegistry } from './session-registry.js';
import { runConflictRead } from './conflict-read.js';
import { runConflictRegistry } from './conflict-registry.js';
import { runConflictReceipt } from './conflict-receipt.js';
import { runHandoffRegistry } from './handoff-registry.js';
import { parseCheckpointListArguments, runCheckpointRegistry } from './checkpoint-registry.js';
import {
  isArtifactUploadCommand,
  parseArtifactUploadArguments,
  readArtifactUploadQuery,
  readArtifactUploadContent,
  artifactUploadResult,
  artifactUploadUnconfirmed,
} from './artifact-upload.js';
import {
  prepareCheckpoint,
  checkpointResult,
  prepareCheckpointRead,
  checkpointReadResult,
} from './checkpoint.js';
import { prepareResume, resumeResult } from './resume.js';
import {
  isSessionActivityCommand,
  prepareSessionActivity,
  sessionActivityResult,
} from './session-activity.js';
import {
  preparePlaneInboxRead,
  planeInboxReadResult,
  preparePlaneInboxRetry,
  planeInboxRetryResult,
} from './plane-inbox.js';

export interface CliResult {
  exit_code: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}

export async function runWorkctx(
  argv: string[],
  router: CommandRouter,
  context: RequestContext,
): Promise<CliResult> {
  const subcommand = argv[1] !== undefined && !argv[1].startsWith('--');
  const command = subcommand ? argv.slice(0, 2).join(' ') : argv[0];
  const operations: Record<string, string> = {
    'inbox init': 'inbox.init',
    'inbox import': 'inbox.import',
    'inbox status': 'inbox.status',
    'inbox consumers': 'inbox.consumers',
    'inbox export-pages': 'inbox.export-pages',
    'inbox inspect-pages': 'inbox.inspect-pages',
    'inbox archive-history': 'inbox.archive-history',
    'inbox archive-page': 'inbox.archive-page',
    'inbox restore-pages': 'inbox.restore-pages',
    'inbox compare-pages': 'inbox.compare-pages',
    'inbox append-pages': 'inbox.append-pages',
    'inbox audit-pages': 'inbox.audit-pages',
    'inbox page-history': 'inbox.page-history',
    'inbox page-get': 'inbox.page-get',
    'inbox head': 'inbox.head',
    'inbox enable-ack': 'inbox.enable-ack',
    'inbox enable-ack-dispatch': 'inbox.enable-ack-dispatch',
    'inbox enable-ack-recovery': 'inbox.enable-ack-recovery',
    'inbox enable-applications': 'inbox.enable-applications',
    'inbox enable-application-restore-receipts': 'inbox.enable-application-restore-receipts',
    'inbox application-restore-receipt': 'inbox.application-restore-receipt',
    'inbox application-status': 'inbox.application-status',
    'inbox application-list': 'inbox.application-list',
    'inbox application-export': 'inbox.application-export',
    'inbox application-restore': 'inbox.application-restore',
    'inbox application-restore-preview': 'inbox.application-restore-preview',
    'inbox application-inspect': 'inbox.application-inspect',
    'inbox application-archive-get': 'inbox.application-archive-get',
    'inbox application-apply': 'inbox.application-apply',
    'inbox application-audit': 'inbox.application-audit',
    'inbox application-replay': 'inbox.application-replay',
    'inbox application-history': 'inbox.application-history',
    'inbox application-get': 'inbox.application-get',
    'inbox ack-status': 'inbox.ack-status',
    'inbox ack-dispatch-status': 'inbox.ack-dispatch-status',
    'inbox ack-history': 'inbox.ack-history',
    'inbox ack-audit': 'inbox.ack-audit',
    'inbox ack-get': 'inbox.ack-get',
    'inbox ack-dispatch-history': 'inbox.ack-dispatch-history',
    'inbox ack-dispatch-get': 'inbox.ack-dispatch-get',
    'inbox ack-recovery-get': 'inbox.ack-recovery-get',
    'inbox ack-evidence-inspect': 'inbox.ack-evidence-inspect',
    'inbox ack-evidence-page': 'inbox.ack-evidence-page',
    'inbox ack-result-inspect': 'inbox.ack-result-inspect',
    'inbox ack-result-page': 'inbox.ack-result-page',
    'inbox ack': 'sync.ack',
    'inbox ack-retry': 'sync.ack',
    'inbox ack-recover': 'sync.ack',
    'inbox ack-observe': 'sync.cursor',
    'admin snapshot': 'workbench.query',
    'sessions identity': 'session.command-context',
    'conflicts identity': 'conflict.command-context',
    'sync identity': 'sync.command-context',
    'sync receipt': 'sync.event.receipt',
    'outbox reconcile': 'sync.event.receipt',
    'outbox inspect-result': 'outbox.inspect-result',
    'outbox list': 'outbox.list',
    'outbox get': 'outbox.get',
    'conflicts submit': 'conflict.resolve',
    'conflicts prepare': 'conflict.command-context',
    'audit list': 'workbench.query',
    'audit get': 'workbench.query',
    'audit export': 'audit.export',
    'artifacts get': 'artifact.read',
    'artifacts version': 'artifact.version.read',
    'artifacts receipt': 'artifact.receipt',
    'artifacts create': 'artifact.create',
    'artifacts put-version': 'artifact.put-version',
    'artifacts download': 'artifact.download',
    'plane-events list': 'plane.inbox.list',
    'plane-events summary': 'plane.inbox.summary',
    'plane-events get': 'plane.inbox.read',
    'plane-events diagnose': 'plane.inbox.diagnosis',
    'plane-events retry': 'plane.inbox.retry',
    'plane-events retry-receipt': 'plane.inbox.retry.receipt',
    'observed project': 'project.state',
    'observed list': 'workitem.observed.list',
    'observed work-item': 'workitem.state',
    'observed context': 'workitem.context',
    'context compile': 'context.pack.compile',
    'context get': 'context.pack.read',
    'context create': 'context.item.create',
    'context read': 'context.item.read',
    'context read-archived': 'context.item.archived.read',
    'context list': 'workbench.query',
    'context update': 'context.item.update',
    'context archive': 'context.item.archive',
    'context restore': 'context.item.restore',
    'context confirm': 'context.item.confirm',
    'context history': 'context.item.history',
    'context version': 'context.item.version.read',
    'proposals create': 'proposal.create',
    'proposals list': 'proposal.list',
    'proposals get': 'proposal.read',
    'proposals confirm': 'proposal.confirm',
    'proposals reject': 'proposal.reject',
    resume: 'session.resume',
    'resume receipt': 'session.resume.receipt',
    checkpoint: 'session.checkpoint',
    'checkpoint receipt': 'session.checkpoint.receipt',
    handoff: 'session.handoff',
    'handoff receipt': 'session.handoff.receipt',
    sync: 'sync.reconcile',
    conflicts: 'conflict.list',
    'conflicts get': 'conflict.read',
    'conflicts receipt': 'conflict.receipt',
    doctor: 'system.doctor',
    'sessions get': 'session.read',
    'checkpoints get': 'session.checkpoint.read',
    'checkpoints history': 'session.checkpoints.list',
    'handoffs get': 'session.handoff.read',
    'sessions start': 'session.start',
    'sessions start-receipt': 'session.start.receipt',
    'sessions end': 'session.end',
    'sessions receipt': 'session.command.receipt',
    'runs start': 'session.run.start',
    'runs finish': 'session.run.finish',
    'runs list': 'session.runs.list',
    'runs get': 'session.run.read',
    'tool-calls list': 'session.tools.list',
    'tool-calls get': 'session.tool.read',
    'tool-calls record': 'session.tool.call',
    'tool-calls finish': 'session.tool.finish',
    'handoff claim': 'session.handoff.claim',
    'handoff claim-receipt': 'session.handoff.claim.receipt',
    'conflicts resolve': 'conflict.resolve',
    'sync changes': 'sync.changes',
    'sync inspect': 'sync.inspect',
    'sync cursor': 'sync.cursor',
    'sync ack': 'sync.ack',
    'sessions list': 'workbench.query',
    overview: 'workbench.query',
    search: 'project.search',
    'index status': 'context.index.status',
    'index list': 'context.index.list',
    'index delete': 'context.index.delete',
    'index restore': 'context.index.restore',
    'work-items get': 'workbench.query',
    'work-items list': 'workbench.query',
    'handoffs list': 'workbench.query',
    'checkpoints list': 'workbench.query',
  };
  const operation =
    command === undefined || !Object.hasOwn(operations, command) ? undefined : operations[command];
  if (!operation)
    return {
      exit_code: 2,
      stdout: '',
      stderr: JSON.stringify({
        code: 'USAGE_ERROR',
        message:
          'Expected admin snapshot, audit, artifacts, plane-events, observed, search, index, overview, work-items, sessions, runs, tool-calls, handoffs, checkpoints, context, resume, checkpoint, handoff, sync, inbox, outbox list/get/reconcile/inspect-result, conflicts or doctor',
        trace_id: context.trace_id,
      }),
    };
  try {
    if (command && isInboxApplicationArchiveCommand(command)) {
      const result = await runInboxApplicationArchiveArguments(argv, context.trace_id);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command && isInboxPageChainCommand(command)) {
      const result = await runInboxPageChainArguments(argv, context.trace_id);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (argv.some((arg) => arg === '--archive-file' || arg.startsWith('--archive-file=')))
      usage(
        '--archive-file is only for inbox inspect-pages/archive-history/archive-page/restore-pages/compare-pages/append-pages/application-inspect/application-archive-get/application-restore/application-restore-preview',
      );
    if (command && isInboxAckResultCommand(command)) {
      const result = await runSyncAckResultArguments(argv, context.trace_id);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command === 'outbox inspect-result') {
      const result = await inspectOutboxReceiptArguments(argv, context.trace_id);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (argv.some((arg) => arg === '--result-file' || arg.startsWith('--result-file=')))
      usage(
        '--result-file is only for inbox ack-result-inspect/ack-result-page or outbox inspect-result',
      );
    if (command && isInboxAckEvidenceCommand(command)) {
      const result = await runSyncAckEvidenceArguments(argv, context.trace_id);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (argv.some((arg) => arg === '--evidence-file' || arg.startsWith('--evidence-file=')))
      usage('--evidence-file is only for inbox ack-evidence-inspect/ack-evidence-page');
    if (command && isInboxAcknowledgementCommand(command)) {
      const result = await runInboxAcknowledgement(argv, router, context);
      return {
        exit_code: result.data.record.state === 'unconfirmed' ? 1 : 0,
        stdout: JSON.stringify(result),
        stderr: '',
      };
    }
    if (
      command !== 'outbox reconcile' &&
      argv.some((arg) => arg === '--result-output' || arg.startsWith('--result-output='))
    )
      usage(
        '--result-output is only for inbox ack/ack-retry/ack-recover/ack-observe or outbox reconcile',
      );
    if (argv.some((arg) => arg === '--dispatch-id' || arg.startsWith('--dispatch-id=')))
      usage('--dispatch-id is only for inbox ack-retry');
    if (argv.some((arg) => arg === '--record-id' || arg.startsWith('--record-id=')))
      usage('--record-id is only for inbox ack-recover');
    if (command && isInboxAckHistoryCommand(command)) {
      const result = await runInboxAckHistoryArguments(argv, context.trace_id);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command && isInboxCommand(command)) {
      const result = await runInboxArguments(argv, context.trace_id);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command === 'sync inspect') {
      const result = await inspectSyncPageArguments(argv, context.trace_id);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command === 'admin snapshot') {
      const result = await runAdminSnapshot(argv, router, context);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command && isOutboxReadCommand(command)) {
      const result = await runOutboxReadArguments(
        argv,
        {
          tenant_id: context.tenant_id,
          workspace_id: context.workspace_id,
          project_id: context.project_id,
        },
        context.trace_id,
      );
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command === 'outbox reconcile') {
      const result = await runOutboxReconcile(argv, router, context);
      return {
        exit_code: result.data.receipt.data.status === 'recorded' ? 0 : 1,
        stdout: JSON.stringify(result),
        stderr: '',
      };
    }
    if (command === 'conflicts get') {
      const result = await runConflictRead(argv, router, context);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command === 'conflicts receipt') {
      const result = await runConflictReceipt(argv, router, context);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command === 'conflicts') {
      const result = await runConflictRegistry(argv, router, context);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command === 'sessions identity') {
      const result = await runSessionCommandContext(argv, router, context);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command === 'conflicts identity') {
      const result = await runConflictCommandContext(argv, router, context);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command === 'sync identity') {
      const result = await runSyncCommandContext(argv, router, context);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command && isSyncConsumerCommand(command)) {
      const result = await runSyncConsumer(argv, router, context);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command === 'sync receipt') {
      const result = await runSyncEventReceipt(argv, router, context);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command === 'conflicts submit') {
      const result = await runConflictSubmission(argv, router, context);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command === 'conflicts prepare') {
      const result = await runConflictPreparation(argv, router, context);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command === 'sessions list') {
      const result = await runSessionRegistry(argv, router, context);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command === 'handoffs list') {
      const result = await runHandoffRegistry(argv, router, context);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command === 'checkpoints list') {
      const query = parseCheckpointListArguments(argv, context.trace_id);
      if (!('session_id' in query)) {
        const result = await runCheckpointRegistry(argv, router, context);
        return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
      }
      const snapshot = structuredClone(context);
      delete snapshot.idempotency_key;
      delete snapshot.expected_version;
      const result = await router.execute({
        operation: 'workbench.query',
        input: { operation: 'checkpoints', ...query },
        context: structuredClone(snapshot),
      });
      const output = checkpointWorkbenchHistoryResult(result, query, snapshot, snapshot.trace_id);
      return { exit_code: 0, stdout: JSON.stringify(output), stderr: '' };
    }
    if (command && isAuditCommand(command)) {
      const result = await runAudit(argv, router, context);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command === 'artifacts download') {
      const result = await runArtifactDownload(argv, router, context);
      return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
    }
    if (command && isArtifactUploadCommand(command)) {
      const uploadContext = { ...context, capability: [...context.capability] };
      const args = parseArtifactUploadArguments(argv, uploadContext.trace_id, true);
      if (
        uploadContext.authenticated_client !== true ||
        !uploadContext.capability.includes('artifact.write')
      )
        throw new ContractError('DENIED', 'Artifact uploads require a verified writer', {
          trace_id: uploadContext.trace_id,
          dispatch_state: 'not-sent',
        });
      const query = await readArtifactUploadQuery(args, uploadContext, uploadContext.trace_id);
      try {
        assertArtifactReceiptIdentity(query.identity, uploadContext);
      } catch {
        throw new ContractError(
          'DENIED',
          'The saved artifact identity differs from the verified writer',
          {
            trace_id: uploadContext.trace_id,
            dispatch_state: 'not-sent',
          },
        );
      }
      const bytes = await readArtifactUploadContent(args, query, uploadContext.trace_id);
      delete uploadContext.idempotency_key;
      delete uploadContext.expected_version;
      uploadContext.idempotency_key = query.command.request_key;
      if (query.command.operation === 'artifact.put-version')
        uploadContext.expected_version = query.command.expected_version;
      const trace = uploadContext.trace_id;
      try {
        const result = await router.execute({
          operation,
          input: {
            request: parseArtifactReceiptQuery(query),
            content: bytes,
            ...(query.command.operation === 'artifact.put-version'
              ? { artifact_id: query.command.artifact_id }
              : {}),
          },
          context: uploadContext,
        });
        return {
          exit_code: 0,
          stdout: JSON.stringify(artifactUploadResult(result, query, trace)),
          stderr: '',
        };
      } catch (error) {
        throw artifactUploadUnconfirmed(error, trace);
      }
    }
    if (command === 'artifacts receipt') {
      const receiptContext = { ...context, capability: [...context.capability] };
      const values = parseRetryArguments(argv.slice(2));
      const query = prepareArtifactReceipt(
        values.json === undefined ? {} : parseInputObject(values.json),
        receiptContext,
        receiptContext.trace_id,
        values.key,
      );
      try {
        if (
          receiptContext.authenticated_client !== true ||
          !receiptContext.capability.includes('artifact.write')
        )
          throw new TypeError();
        assertArtifactReceiptIdentity(query.identity, receiptContext);
      } catch {
        throw new ContractError(
          'DENIED',
          'The original artifact identity requires a matching verified writer',
          {
            trace_id: receiptContext.trace_id,
          },
        );
      }
      const trace = receiptContext.trace_id;
      delete receiptContext.idempotency_key;
      delete receiptContext.expected_version;
      const result = await router.execute({
        operation,
        input: { ...parseArtifactReceiptQuery(query) },
        context: receiptContext,
      });
      return {
        exit_code: 0,
        stdout: JSON.stringify(artifactReceiptResult(result, query, trace)),
        stderr: '',
      };
    }
    const isPlaneRetry =
      command === 'plane-events retry' || command === 'plane-events retry-receipt';
    const isHandoffClaim = command === 'handoff claim' || command === 'handoff claim-receipt';
    const isHandoffCreate = command === 'handoff' || command === 'handoff receipt';
    const isSessionStart = command === 'sessions start' || command === 'sessions start-receipt';
    const isSessionActivity = isSessionActivityCommand(command!);
    const isCheckpoint = command === 'checkpoint' || command === 'checkpoint receipt';
    const isResume = command === 'resume' || command === 'resume receipt';
    let input: Record<string, unknown> =
      isPlaneRetry ||
      isHandoffClaim ||
      isHandoffCreate ||
      isSessionStart ||
      isSessionActivity ||
      isCheckpoint ||
      isResume
        ? {}
        : parseJsonArgument(argv.slice(subcommand ? 2 : 1));
    let commandContext = context;
    let artifactRead;
    const artifactScope = { ...context };
    if (isArtifactReadCommand(command!)) {
      const values = parseRetryArguments(argv.slice(subcommand ? 2 : 1));
      artifactRead = prepareArtifactRead(
        command!,
        values.json === undefined ? {} : parseInputObject(values.json),
        context.trace_id,
        values.key,
      );
      input = {
        ...artifactRead,
        ...(artifactRead?.version === undefined ? {} : { version: String(artifactRead.version) }),
      };
      const { idempotency_key: _key, expected_version: _version, ...readContext } = context;
      commandContext = { ...readContext, capability: [...readContext.capability] };
    }
    let handoffRead;
    if (command === 'handoffs get') {
      const values = parseRetryArguments(argv.slice(subcommand ? 2 : 1));
      handoffRead = prepareHandoffRead(
        command,
        values.json === undefined ? {} : parseInputObject(values.json),
        context.trace_id,
        values.key,
      );
      input = { ...handoffRead };
      const { idempotency_key: _key, expected_version: _version, ...readContext } = context;
      commandContext = readContext;
    }
    let checkpointRead;
    let checkpointHistory;
    if (command === 'checkpoints history') {
      const values = parseRetryArguments(argv.slice(subcommand ? 2 : 1));
      checkpointHistory = prepareCheckpointHistory(
        command,
        values.json === undefined ? {} : parseInputObject(values.json),
        context.trace_id,
        values.key,
      );
      input = { ...checkpointHistory };
      const { idempotency_key: _key, expected_version: _version, ...readContext } = context;
      commandContext = readContext;
    }
    if (command === 'checkpoints get') {
      const values = parseRetryArguments(argv.slice(subcommand ? 2 : 1));
      checkpointRead = prepareCheckpointRead(
        command,
        values.json === undefined ? {} : parseInputObject(values.json),
        context.trace_id,
        values.key,
      );
      input = { ...checkpointRead };
      const { idempotency_key: _key, expected_version: _version, ...readContext } = context;
      commandContext = readContext;
    }
    let sessionState: { session_id: string } | undefined;
    if (command === 'sessions get') {
      const values = parseRetryArguments(argv.slice(subcommand ? 2 : 1));
      sessionState = prepareSessionState(
        command,
        values.json === undefined ? {} : parseInputObject(values.json),
        context.trace_id,
        values.key,
      );
      input = { ...sessionState };
      const { idempotency_key: _key, expected_version: _version, ...readContext } = context;
      commandContext = readContext;
    }
    let retryKey: string | undefined;
    if (
      isPlaneRetry ||
      isHandoffClaim ||
      isHandoffCreate ||
      isSessionStart ||
      isSessionActivity ||
      isCheckpoint ||
      isResume
    ) {
      const values = parseRetryArguments(argv.slice(subcommand ? 2 : 1));
      if (values.json !== undefined) input = parseInputObject(values.json);
      if (values.key !== undefined) {
        if (
          command === 'plane-events retry-receipt' ||
          command === 'handoff claim-receipt' ||
          command === 'handoff receipt' ||
          command === 'sessions start-receipt' ||
          command === 'checkpoint receipt' ||
          command === 'resume receipt' ||
          command === 'sessions receipt'
        )
          usage('Receipt queries use request_key in JSON, without --key');
        retryKey = values.key;
        if (context.idempotency_key !== undefined && context.idempotency_key !== retryKey)
          usage('--key and the request context key disagree');
      } else if (
        command === 'plane-events retry' ||
        command === 'handoff claim' ||
        command === 'handoff' ||
        command === 'sessions start' ||
        command === 'checkpoint' ||
        command === 'resume' ||
        command === 'runs start' ||
        command === 'tool-calls record' ||
        command === 'runs finish' ||
        command === 'tool-calls finish' ||
        command === 'sessions end'
      )
        retryKey = context.idempotency_key;
    }
    const resume = prepareResume(command!, input, context, context.trace_id, retryKey);
    if (resume) {
      const { binding, lookup } = resume;
      if (
        context.authenticated_client !== true ||
        context.actor_id !== binding.identity.actor_id ||
        context.client_id !== binding.identity.client_id
      )
        throw new ContractError(
          'DENIED',
          'Authenticated identity differs from the original resume',
          { trace_id: context.trace_id },
        );
      if (!lookup && context.expected_version !== undefined)
        usage('Resume does not accept a version precondition');
      if (
        context.client_id === (process.env.AUTH_SERVER_CLIENT_ID ?? 'PlaneMem_WebConsole') &&
        !binding.query.require_claimed
      )
        usage('This client requires the original effective require_claimed=true');
      input = resume.input;
      const { idempotency_key: _key, expected_version: _version, ...identityContext } = context;
      commandContext = {
        ...identityContext,
        ...(lookup ? {} : { idempotency_key: binding.query.request_key }),
      };
    }
    const checkpoint = prepareCheckpoint(command!, input, context, context.trace_id, retryKey);
    if (checkpoint) {
      const { binding, lookup } = checkpoint;
      if (
        context.authenticated_client !== true ||
        context.actor_id !== binding.identity.actor_id ||
        context.client_id !== binding.identity.client_id
      )
        throw new ContractError(
          'DENIED',
          'Authenticated identity differs from the original checkpoint',
          { trace_id: context.trace_id },
        );
      if (
        !lookup &&
        context.expected_version !== undefined &&
        context.expected_version !== binding.query.checkpoint.expected_version
      )
        usage('Original checkpoint version differs from the request context');
      input = checkpoint.input;
      const { idempotency_key: _key, expected_version: _version, ...identityContext } = context;
      commandContext = {
        ...identityContext,
        ...(lookup
          ? {}
          : {
              idempotency_key: binding.query.request_key,
              expected_version: binding.query.checkpoint.expected_version,
            }),
      };
    }
    const sessionActivity = prepareSessionActivity(
      command!,
      input,
      context,
      context.trace_id,
      retryKey,
    );
    if (sessionActivity) {
      const { binding, lookup } = sessionActivity;
      if (
        context.authenticated_client !== true ||
        binding.identity.actor_id !== context.actor_id ||
        binding.identity.client_id !== context.client_id
      )
        throw new ContractError(
          'DENIED',
          'Authenticated identity differs from the original session command',
          { trace_id: context.trace_id },
        );
      if (
        !lookup &&
        context.expected_version !== undefined &&
        context.expected_version !== binding.query.command.expected_version
      )
        usage('Original activity version differs from the request context version');
      input = sessionActivity.input;
      const { idempotency_key: _key, expected_version: _version, ...identityContext } = context;
      commandContext = {
        ...identityContext,
        ...(lookup
          ? {}
          : {
              idempotency_key: binding.query.request_key,
              expected_version: binding.query.command.expected_version,
            }),
      };
    }
    const sessionStart = prepareSessionStart(command!, input, context, context.trace_id, retryKey);
    if (sessionStart) {
      if (
        context.authenticated_client !== true ||
        sessionStart.binding.identity.actor_id !== context.actor_id ||
        sessionStart.binding.identity.client_id !== context.client_id
      )
        throw new ContractError(
          'DENIED',
          'Authenticated identity differs from the original session start',
          { trace_id: context.trace_id },
        );
      if (!sessionStart.lookup && context.expected_version !== undefined)
        usage('Session start does not use a version precondition');
      input = sessionStart.input;
      const { idempotency_key: _key, expected_version: _version, ...identityContext } = context;
      commandContext = {
        ...identityContext,
        ...(sessionStart.lookup ? {} : { idempotency_key: sessionStart.binding.query.request_key }),
      };
    }
    const handoffCreate = prepareHandoffCreate(
      command!,
      input,
      context,
      context.trace_id,
      retryKey,
    );
    if (handoffCreate) {
      if (
        context.authenticated_client !== true ||
        handoffCreate.binding.identity.actor_id !== context.actor_id ||
        handoffCreate.binding.identity.client_id !== context.client_id
      )
        throw new ContractError(
          'DENIED',
          'Authenticated identity differs from the original creation',
          { trace_id: context.trace_id },
        );
      if (!handoffCreate.lookup && context.expected_version !== undefined)
        usage('Handoff creation does not use a version precondition');
      input = handoffCreate.input;
      const { idempotency_key: _key, expected_version: _version, ...identityContext } = context;
      commandContext = {
        ...identityContext,
        ...(handoffCreate.lookup
          ? {}
          : { idempotency_key: handoffCreate.binding.query.request_key }),
      };
    }
    const handoffClaim = prepareHandoffClaim(command!, input, context, context.trace_id, retryKey);
    if (handoffClaim) {
      if (
        context.authenticated_client !== true ||
        handoffClaim.binding.identity.actor_id !== context.actor_id ||
        handoffClaim.binding.identity.client_id !== context.client_id
      )
        throw new ContractError(
          'DENIED',
          'Authenticated identity differs from the original handoff claim',
          { trace_id: context.trace_id },
        );
      if (
        !handoffClaim.lookup &&
        context.expected_version !== undefined &&
        context.expected_version !== handoffClaim.binding.query.claim.expected_version
      )
        usage('The original handoff version differs from the request context version');
      input = handoffClaim.input;
      const { idempotency_key: _key, expected_version: _version, ...identityContext } = context;
      commandContext = {
        ...identityContext,
        ...(handoffClaim.lookup
          ? {}
          : {
              idempotency_key: handoffClaim.binding.query.request_key,
              expected_version: handoffClaim.binding.query.claim.expected_version,
            }),
      };
    }
    const planeRetry = preparePlaneInboxRetry(command!, input, context, context.trace_id, retryKey);
    if (planeRetry) {
      if (
        planeRetry.identity.actor_id !== context.actor_id ||
        planeRetry.identity.client_id !== context.client_id
      )
        throw new ContractError(
          'DENIED',
          'Authenticated identity changed since the retry command was prepared',
          { trace_id: context.trace_id },
        );
      input = { ...planeRetry.input };
      const { idempotency_key: _key, expected_version: _version, ...identityContext } = context;
      commandContext = {
        ...identityContext,
        ...(planeRetry.lookup ? {} : { idempotency_key: planeRetry.input.request_key }),
      };
    }
    const planeInbox = preparePlaneInboxRead(command!, input, context.trace_id);
    if (planeInbox) {
      if (argv.includes('--key')) usage('Event queue reads do not accept --key');
      input = planeInbox.input;
    }
    const observed = prepareObservedRead(command!, input, context.project_id, context.trace_id);
    if (observed) {
      if (argv.includes('--key')) usage('Observed reads do not accept --key');
      input = observed.input;
    }
    if (operation === 'workbench.query')
      input.operation =
        command === 'work-items get'
          ? 'work_item'
          : command === 'work-items list'
            ? 'work_items'
            : command!.split(' ')[0];
    const result = await router.execute({ operation, input, context: commandContext });
    const output = artifactRead
      ? artifactReadResult(result, artifactRead, artifactScope, artifactScope.trace_id)
      : checkpointHistory
        ? checkpointHistoryResult(result, checkpointHistory, context, context.trace_id)
        : handoffRead
          ? handoffReadResult(result, handoffRead, context, context.trace_id)
          : checkpointRead
            ? checkpointReadResult(result, checkpointRead, context, context.trace_id)
            : resume
              ? resumeResult(result, resume, context.trace_id)
              : checkpoint
                ? checkpointResult(result, checkpoint, context.trace_id)
                : sessionState
                  ? sessionStateResult(result, sessionState, context, context.trace_id)
                  : sessionActivity
                    ? sessionActivityResult(result, sessionActivity, context.trace_id)
                    : sessionStart
                      ? sessionStartResult(result, sessionStart, context.trace_id)
                      : handoffCreate
                        ? handoffCreateResult(result, handoffCreate, context.trace_id)
                        : handoffClaim
                          ? handoffClaimResult(result, handoffClaim, context.trace_id)
                          : observed
                            ? observedReadResult(result, observed, context, context.trace_id)
                            : planeInbox
                              ? planeInboxReadResult(result, planeInbox, context, context.trace_id)
                              : planeRetry
                                ? planeInboxRetryResult(result, planeRetry, context.trace_id)
                                : result;
    return { exit_code: 0, stdout: JSON.stringify(output), stderr: '' };
  } catch (error) {
    const envelope =
      error instanceof ContractError
        ? error.envelope
        : {
            code: 'INTERNAL_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
            trace_id: context.trace_id,
            retryable: true,
          };
    return {
      exit_code: envelope.code === 'USAGE_ERROR' ? 2 : 1,
      stdout: '',
      stderr: JSON.stringify(envelope),
    };
  }
}

function parseRetryArguments(args: string[]) {
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      tokens: true,
      options: { json: { type: 'string' }, key: { type: 'string' } },
    });
    const seen = new Set<string>();
    for (const token of parsed.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) usage('Retry options must not be repeated');
      seen.add(token.name);
    }
    return parsed.values;
  } catch (error) {
    return usage(error instanceof Error ? error.message : 'Invalid retry arguments');
  }
}

function parseJsonArgument(args: string[]): Record<string, unknown> {
  const jsonIndex = args.indexOf('--json');
  if (jsonIndex < 0) return {};
  const value = args[jsonIndex + 1];
  if (value === undefined)
    throw new ContractError('USAGE_ERROR', '--json requires an object', {
      trace_id: 'trace_cli_usage',
      retryable: false,
    });
  return parseInputObject(value);
}

export function usage(message: string): never {
  throw new ContractError('USAGE_ERROR', message);
}

export function parseInputObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value.replace(/^\uFEFF/, ''));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw new Error('object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ContractError('USAGE_ERROR', '--json must contain a JSON object', {
      trace_id: 'trace_cli_usage',
      retryable: false,
    });
  }
}

export function parityFingerprint(result: CommandResult): string {
  return JSON.stringify({
    schema_version: result.schema_version,
    trace_id: result.trace_id,
    source_refs: result.source_refs,
    data: result.data,
  });
}
