import { open } from 'node:fs/promises';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import {
  ContractError,
  createUlid,
  isUlid,
  parseCreateProposal,
  PROPOSAL_CREATE_RECEIPT_REQUEST_BYTES,
  validateIdempotencyKey,
} from '@planemem/contracts';
import { flushProposalQueue } from './publisher.js';
import {
  readProposalQueueReceipt,
  reconcileProposalQueueJob,
  ProposalQueueReceiptError,
  type ProposalQueueReceiptResult,
} from './proposal-reconciliation.js';
import {
  SqliteProposalQueue,
  normalizeQueueBinding,
  type ProposalQueueBinding,
} from './submission.js';
import {
  createProposalQueueReceiptRecord,
  proposalQueueReceiptRecordSummary,
  readProposalQueueReceiptRecord,
  prepareProposalReceiptRecordOutput,
  saveProposalQueueReceiptRecord,
  type ProposalQueueReceiptRecord,
} from './proposal-receipt-record.js';
import { readProposalReceiptRecordRecovery } from './proposal-receipt-recovery.js';
import { readProposalQueueBackupRecovery } from './proposal-queue-backup-recovery.js';
import { compareProposalQueueBackups } from './proposal-queue-backup-comparison.js';
import {
  getProposalQueueBackupJob,
  listProposalQueueBackupJobs,
  parseProposalQueueBackupJobSelection,
  parseProposalQueueBackupListQuery,
  prepareProposalQueueBackupReceiptQuery,
} from './proposal-queue-backup-access.js';
import { restoreProposalQueueBackup } from './proposal-queue-restore.js';
import {
  proposalQueueBackupSummary,
  readProposalQueueBackup,
  prepareProposalQueueBackupOutput,
  saveProposalQueueBackup,
} from './proposal-queue-backup.js';
import {
  generateProposalDraft,
  parseProposalGenerationProvider,
  parseProposalGenerationRequest,
} from './generation.js';
import {
  prepareGenerationOutput,
  saveGeneratedDraft,
  savePreparedGeneration,
  saveProposalGenerationRecord,
  saveGenerationFile,
} from './generation-output.js';
import {
  prepareProposalGeneration,
  parseProposalGenerationSelection,
} from './generation-sources.js';
import {
  createPreparedProposalRecord,
  createGeneratedProposalRecord,
  inspectProposalGenerationRecord,
  readGeneratedProposalDraft,
  PROPOSAL_GENERATION_RECORD_BYTES,
  type ProposalGenerationRecord,
  type GeneratedProposalRecord,
} from './generation-record.js';
import { parseGenerationHistoryQuery, validateGenerationDigest } from './generation-history.js';
import {
  prepareGenerationRequest,
  readGenerationRequest,
  runGenerationRequest,
  recoverGenerationRequest,
  GenerationJournalWriteError,
} from './generation-journal.js';
import { generationRequestSummary, validateGenerationRequestKey } from './generation-request.js';
import { GENERATION_RECOVERY_BYTES } from './generation-recovery.js';
import { listGenerationRequests, parseGenerationCatalogQuery } from './generation-catalog.js';

const help = `Proposal submission queue (Node.js 24)
  proposal-worker prepare-generation --binding binding.json --file selection.json --output NEW_SOURCES.json [--record]
  proposal-worker generate --provider provider.json --file sources.json --output NEW_DRAFT.json
  proposal-worker generate-prepared --provider provider.json --file PREPARATION_RECORD.json --output NEW_GENERATION_RECORD.json
  proposal-worker inspect-generation --file RECORD.json
  proposal-worker generation-request --journal EXISTING_DIR --binding binding.json --key KEY --file PREPARATION_RECORD.json --provider provider.json
  proposal-worker generation-run --journal EXISTING_DIR --binding binding.json --key KEY
  proposal-worker generation-status --journal EXISTING_DIR --binding binding.json --key KEY
  proposal-worker generation-result --journal EXISTING_DIR --binding binding.json --key KEY --output NEW_RECORD.json
  proposal-worker generation-recover --journal EXISTING_DIR --binding binding.json --key KEY --file RETAINED_ERROR.json [--preview]
  proposal-worker generation-requests --journal EXISTING_DIR --binding binding.json [--state all|prepared|attempted|generated|failed] [--after CURSOR] [--limit 10]
  proposal-worker enqueue-generated --queue queue.sqlite --binding binding.json --file GENERATION_RECORD.json --key KEY
  proposal-worker generation-list --queue queue.sqlite --binding binding.json --id JOB_ID [--after SHA256] [--limit 10]
  proposal-worker generation-get --queue queue.sqlite --binding binding.json --id JOB_ID --sha256 SHA256 [--output NEW_RECORD.json]
  proposal-worker enqueue --queue queue.sqlite --binding binding.json --file draft.json --key KEY
  proposal-worker list    --queue queue.sqlite --binding binding.json [--before JOB_ID] [--limit 25]
  proposal-worker get     --queue queue.sqlite --binding binding.json --id JOB_ID
  proposal-worker queue-backup --queue EXISTING.sqlite --binding binding.json --output NEW_BACKUP.json
  proposal-worker inspect-queue-backup --file BACKUP.json
  proposal-worker queue-backup-list --file BACKUP.json [--state all|queued|sending|retry|blocked|submitted] [--limit 25] [--before JOB_ID --sha256 BACKUP_SHA256]
  proposal-worker queue-backup-get --file BACKUP.json --sha256 BACKUP_SHA256 --id JOB_ID
  proposal-worker queue-backup-receipt-query --file BACKUP.json --sha256 BACKUP_SHA256 --id JOB_ID --output NEW_QUERY.json
  proposal-worker queue-backup-recover --file RETAINED_BACKUP_OR_ERROR.json --output NEW_BACKUP.json [--preview]
  proposal-worker queue-backup-compare --queue EXISTING.sqlite --binding binding.json --file BACKUP.json
  proposal-worker queue-backup-restore --file BACKUP.json --binding binding.json --output NEW_QUEUE.sqlite --preview
  proposal-worker queue-backup-restore --file BACKUP.json --binding binding.json --output NEW_QUEUE.sqlite --confirm-sha256 BACKUP_SHA256
  proposal-worker queue-backup-merge --queue EXISTING.sqlite --binding binding.json --file BACKUP.json --preview
  proposal-worker queue-backup-merge --queue EXISTING.sqlite --binding binding.json --file BACKUP.json --confirm-sha256 PLAN_SHA256
  proposal-worker retry   --queue queue.sqlite --binding binding.json --id JOB_ID
  proposal-worker receipt --queue EXISTING.sqlite --binding binding.json --id JOB_ID [--timeout-ms 30000] [--output NEW_RECEIPT.json]
  proposal-worker reconcile --queue EXISTING.sqlite --binding binding.json --id JOB_ID [--timeout-ms 30000] [--output NEW_RECEIPT.json]
  proposal-worker inspect-receipt-record --file RECEIPT_RECORD.json
  proposal-worker receipt-record-recover --file RETAINED_RECORD_OR_ERROR.json --output NEW_RECEIPT.json [--preview]
  proposal-worker flush   --queue queue.sqlite --binding binding.json [--limit 25]

binding.json contains gateway_url, tenant_id, workspace_id, project_id, actor_id, client_id.
list/get open an existing initialized queue read-only; missing files are never created.
queue-backup saves a complete known-v1 logical snapshot after read-only queue close; inspect-queue-backup validates it offline. Neither restores, retries or sends tasks.
queue-backup-list/get inspect the complete backup offline before selecting historical jobs; continuations and selections bind its digest. get includes original content and copied leases, not current task authority.
queue-backup-receipt-query saves the selected original identity/key/draft query as a new file for an explicit later receipt lookup at the original gateway. It never opens a queue, queries a receipt or sends a task.
queue-backup-recover saves a retained complete snapshot to a new file; --preview only inspects input and destination. Neither mode opens or restores a queue.
queue-backup-compare compares a complete backup with a read-only existing queue snapshot, then closes before reporting metadata differences. It never restores or sends; exit 0 also permits differences.
queue-backup-restore creates a new queue after digest confirmation. Every non-submitted task becomes blocked/uncertain; old leases are cleared only in the new copy. Preview creates nothing. Keep the original backup.
queue-backup-merge previews the complete existing target read-only. Confirm its plan digest to atomically add only missing rows; conflicts or any target change reject the merge. Existing tasks are never updated.
generate calls the configured model once using PROPOSAL_GENERATION_API_KEY; it saves a new draft, without opening a queue.
generate-prepared uses the same single call and saves the complete record; it does not refresh sources.
inspect-generation verifies record consistency offline; enqueue-generated requires the original destination binding.
enqueue-generated stores the record with the job atomically; generation-list/get open existing queues read-only.
generation-request saves immutable input; generation-run claims it once before calling the model. Existing attempts never resend.
generation-status/result read saved journal files without model calls; a generated request can replay its saved result.
generation-recover imports retained outcomes for the original existing attempt; --preview only reads. It never calls the model.
generation-requests discovers requests for the original binding; follow next_cursor even when a filtered page is empty.
prepare-generation reads pinned sources; flush submits known-unsent drafts or reads receipts for unknown outcomes.
Both use PROPOSAL_WORKER_ACCESS_TOKEN. retry preserves unknown outcomes and never clears uncertainty.
retry schedules the original draft/key; it does not send or regenerate content.
receipt only queries the original creation. reconcile explicitly settles unchanged non-sending jobs from a recorded receipt; neither submits.
Optional receipt/reconcile output saves a new full record after queue close. inspect-receipt-record checks file consistency offline, not authenticity or current state.
receipt-record-recover saves retained complete records to a new file; --preview only inspects. Neither mode queries or settles a queue.
Exit codes: 0 completed (receipt may be not-observed), 1 command/storage failure, 2 flush had unsettled jobs or reconciliation did not settle.
`;

export async function main(args: string[]): Promise<number> {
  let queue: SqliteProposalQueue | undefined;
  try {
    if (!args.length || (args.length === 1 && ['--help', '-h', 'help'].includes(args[0]!))) {
      process.stdout.write(help);
      return 0;
    }
    const { values, positionals, tokens } = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      tokens: true,
      options: {
        queue: { type: 'string' },
        binding: { type: 'string' },
        file: { type: 'string' },
        key: { type: 'string' },
        id: { type: 'string' },
        before: { type: 'string' },
        limit: { type: 'string' },
        provider: { type: 'string' },
        output: { type: 'string' },
        record: { type: 'boolean' },
        after: { type: 'string' },
        sha256: { type: 'string' },
        journal: { type: 'string' },
        preview: { type: 'boolean' },
        state: { type: 'string' },
        'timeout-ms': { type: 'string' },
        'confirm-sha256': { type: 'string' },
      },
    });
    const command = positionals[0];
    const allowed: Record<string, string[]> = {
      'prepare-generation': ['binding', 'file', 'output', 'record'],
      generate: ['provider', 'file', 'output'],
      'generate-prepared': ['provider', 'file', 'output'],
      'inspect-generation': ['file'],
      'generation-request': ['journal', 'binding', 'key', 'file', 'provider'],
      'generation-run': ['journal', 'binding', 'key'],
      'generation-status': ['journal', 'binding', 'key'],
      'generation-result': ['journal', 'binding', 'key', 'output'],
      'generation-recover': ['journal', 'binding', 'key', 'file', 'preview'],
      'generation-requests': ['journal', 'binding', 'state', 'after', 'limit'],
      'enqueue-generated': ['file', 'key'],
      'generation-list': ['id', 'after', 'limit'],
      'generation-get': ['id', 'sha256', 'output'],
      enqueue: ['file', 'key'],
      list: ['before', 'limit'],
      get: ['id'],
      'queue-backup': ['output'],
      'inspect-queue-backup': ['file'],
      'queue-backup-list': ['file', 'state', 'limit', 'before', 'sha256'],
      'queue-backup-get': ['file', 'sha256', 'id'],
      'queue-backup-receipt-query': ['file', 'sha256', 'id', 'output'],
      'queue-backup-recover': ['file', 'output', 'preview'],
      'queue-backup-compare': ['file'],
      'queue-backup-restore': ['file', 'binding', 'output', 'preview', 'confirm-sha256'],
      'queue-backup-merge': ['file', 'preview', 'confirm-sha256'],
      retry: ['id'],
      receipt: ['id', 'timeout-ms', 'output'],
      reconcile: ['id', 'timeout-ms', 'output'],
      'inspect-receipt-record': ['file'],
      'receipt-record-recover': ['file', 'output', 'preview'],
      flush: ['limit'],
    };
    if (!command || !Object.hasOwn(allowed, command) || positionals.length !== 1)
      throw new TypeError('Unknown proposal worker command; use --help for syntax');
    for (const option of Object.keys(values))
      if (
        ![
          ...([
            'generate',
            'prepare-generation',
            'generate-prepared',
            'inspect-generation',
            'inspect-receipt-record',
            'inspect-queue-backup',
            'queue-backup-list',
            'queue-backup-get',
            'queue-backup-receipt-query',
            'queue-backup-recover',
            'queue-backup-restore',
            'receipt-record-recover',
            'generation-request',
            'generation-run',
            'generation-status',
            'generation-result',
            'generation-recover',
            'generation-requests',
          ].includes(command)
            ? []
            : ['queue', 'binding']),
          ...allowed[command]!,
        ].includes(option)
      )
        throw new TypeError('Unexpected option for ' + command);
    // Duplicate options are rejected instead of silently accepting a later path/key.
    const seen = new Set<string>();
    for (const token of tokens) {
      if (token.kind !== 'option') continue;
      const name = token.name;
      if (seen.has(name)) throw new TypeError('Duplicate option ' + name);
      seen.add(name);
    }
    const required = (name: keyof typeof values) => {
      const value = values[name];
      if (typeof value !== 'string' || !value.trim())
        throw new TypeError('--' + name + ' is required');
      return value;
    };
    if (command === 'inspect-queue-backup') {
      const backup = await readProposalQueueBackup(required('file'));
      process.stdout.write(JSON.stringify(proposalQueueBackupSummary(backup), null, 2) + '\n');
      return 0;
    }
    if (command === 'queue-backup-list') {
      if (
        values.limit !== undefined &&
        (!/^[1-9]\d{0,2}$/.test(values.limit) || values.limit !== String(Number(values.limit)))
      )
        throw new TypeError('--limit must be between 1 and 100');
      const query = parseProposalQueueBackupListQuery({
        limit: values.limit === undefined ? 25 : Number(values.limit),
        state: values.state ?? 'all',
        before: values.before ?? null,
        backup_sha256: values.sha256 ?? null,
      });
      const backup = await readProposalQueueBackup(required('file'));
      const result = listProposalQueueBackupJobs(backup, query);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return 0;
    }
    if (command === 'queue-backup-get' || command === 'queue-backup-receipt-query') {
      const selection = parseProposalQueueBackupJobSelection({
        backup_sha256: required('sha256'),
        job_id: required('id'),
      });
      const target = command === 'queue-backup-receipt-query' ? required('output') : undefined;
      const backup = await readProposalQueueBackup(required('file'));
      if (command === 'queue-backup-get') {
        process.stdout.write(
          JSON.stringify(getProposalQueueBackupJob(backup, selection), null, 2) + '\n',
        );
        return 0;
      }
      const recovery = prepareProposalQueueBackupReceiptQuery(backup, selection);
      const { query, ...summary } = recovery;
      let outputPath = target!;
      let exportPhase = 'prepare';
      let report: unknown;
      try {
        // Compact JSON preserves the receipt endpoint's original 1 MiB input budget.
        const bytes = Buffer.from(JSON.stringify(query), 'utf8');
        if (bytes.byteLength > PROPOSAL_CREATE_RECEIPT_REQUEST_BYTES) throw new TypeError();
        const destination = await prepareGenerationOutput(target!);
        outputPath = destination.path;
        exportPhase = 'save';
        const saved = await saveGenerationFile(
          destination,
          bytes,
          PROPOSAL_CREATE_RECEIPT_REQUEST_BYTES,
          'trace_worker_backup_query_' + createUlid(),
          'PROPOSAL_QUEUE_BACKUP_QUERY_SAVE_FAILED',
        );
        report = { ...summary, output: { ...saved, format: 'proposal-create-receipt-query' } };
      } catch (error) {
        process.stderr.write(
          JSON.stringify(
            {
              code: 'PROPOSAL_QUEUE_BACKUP_QUERY_EXPORT_FAILED',
              recovery,
              output: {
                output_path: outputPath,
                export_phase: exportPhase,
                ...(error instanceof ContractError ? error.envelope.details : {}),
              },
            },
            null,
            2,
          ) + '\n',
        );
        return 1;
      }
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      return 0;
    }
    if (command === 'queue-backup-merge') {
      const path = required('queue');
      const preview = values.preview === true;
      const confirmation = values['confirm-sha256'];
      if (
        (preview && confirmation !== undefined) ||
        (!preview && (typeof confirmation !== 'string' || !/^[a-f0-9]{64}$/.test(confirmation)))
      )
        throw new ContractError(
          'PROPOSAL_QUEUE_MERGE_CONFIRMATION_REQUIRED',
          'Preview or confirm the complete merge plan SHA-256',
        );
      const backup = await readProposalQueueBackup(required('file'));
      const binding = normalizeQueueBinding(
        (await readJson(required('binding'), 16_384)) as ProposalQueueBinding,
      );
      if (!isDeepStrictEqual(binding, backup.binding))
        throw new ContractError(
          'PROPOSAL_QUEUE_BINDING_MISMATCH',
          'Keep the original backup binding when merging',
        );
      queue = new SqliteProposalQueue(path, binding, { readonly: preview, existing: true });
      const connection = queue;
      let result: Record<string, unknown> | undefined;
      let failure: unknown;
      let failed = false;
      try {
        result = preview
          ? { ...connection.previewBackupMerge(backup), state: 'preview', mutation: 'none' }
          : connection.mergeBackup(backup, confirmation!);
      } catch (error) {
        failed = true;
        failure = error;
      }
      queue = undefined;
      let closed = true;
      try {
        connection.close();
      } catch {
        closed = false;
      }
      if (failed || !closed) {
        process.stderr.write(
          JSON.stringify(
            {
              code: !closed
                ? 'PROPOSAL_QUEUE_MERGE_CLOSE_FAILED'
                : failure instanceof ContractError
                  ? failure.envelope.code
                  : 'PROPOSAL_QUEUE_MERGE_FAILED',
              mutation: result?.mutation ?? 'none',
              ...(failure instanceof ContractError
                ? { ...failure.envelope.details, operation_error_code: failure.envelope.code }
                : {}),
              ...(result ? { result } : {}),
              close_state: closed ? 'closed' : 'not-confirmed',
            },
            null,
            2,
          ) + '\n',
        );
        return 1;
      }
      process.stdout.write(JSON.stringify({ ...result, close_state: 'closed' }, null, 2) + '\n');
      return 0;
    }
    if (command === 'queue-backup-restore') {
      const file = required('file');
      const bindingFile = required('binding');
      const output = required('output');
      const backup = await readProposalQueueBackup(file);
      const binding = (await readJson(bindingFile, 16_384)) as ProposalQueueBinding;
      let result: unknown;
      try {
        result = await restoreProposalQueueBackup(backup, binding, output, {
          ...(values.preview === undefined ? {} : { preview: values.preview }),
          ...(values['confirm-sha256'] === undefined
            ? {}
            : { confirm_sha256: values['confirm-sha256'] }),
        });
      } catch (error) {
        if (
          !(error instanceof ContractError) ||
          error.envelope.code !== 'PROPOSAL_QUEUE_RESTORE_FAILED'
        )
          throw error;
        process.stderr.write(
          JSON.stringify({ code: error.envelope.code, ...error.envelope.details }, null, 2) + '\n',
        );
        return 1;
      }
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return 0;
    }
    if (command === 'queue-backup-compare') {
      const path = required('queue');
      const backup = await readProposalQueueBackup(required('file'));
      const binding = normalizeQueueBinding(
        (await readJson(required('binding'), 16_384)) as ProposalQueueBinding,
      );
      if (!isDeepStrictEqual(binding, backup.binding))
        throw new ContractError(
          'PROPOSAL_QUEUE_BINDING_MISMATCH',
          'Keep the original backup gateway, project and identity when comparing a queue',
        );
      queue = new SqliteProposalQueue(path, binding, { readonly: true, existing: true });
      const current = queue.backup();
      const reader = queue;
      queue = undefined;
      reader.close();
      const comparison = compareProposalQueueBackups(backup, current);
      process.stdout.write(
        JSON.stringify({ ...comparison, close_state: 'closed' }, null, 2) + '\n',
      );
      return 0;
    }
    if (command === 'queue-backup-recover') {
      const target = required('output');
      const recovery = await readProposalQueueBackupRecovery(required('file'));
      const summary = proposalQueueBackupSummary(recovery.backup);
      let outputPath = target;
      let exportPhase = 'prepare';
      let report: unknown;
      try {
        const destination = await prepareProposalQueueBackupOutput(target);
        outputPath = destination.path;
        if (values.preview) {
          report = {
            ...summary,
            recovery_source: recovery.source,
            queue_access: 'none',
            output: { state: 'preview', path: destination.path },
          };
        } else {
          exportPhase = 'save';
          const saved = await saveProposalQueueBackup(destination, recovery.backup);
          report = {
            ...summary,
            recovery_source: recovery.source,
            queue_access: 'none',
            output: saved,
          };
        }
      } catch (error) {
        process.stderr.write(
          JSON.stringify(
            {
              code: 'PROPOSAL_QUEUE_BACKUP_RECOVERY_FAILED',
              backup: recovery.backup,
              output: {
                output_path: outputPath,
                export_phase: exportPhase,
                close_state: 'not-opened',
                ...(error instanceof ContractError ? error.envelope.details : {}),
              },
            },
            null,
            2,
          ) + '\n',
        );
        return 1;
      }
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      return 0;
    }
    if (command === 'queue-backup') {
      const path = required('queue');
      const binding = (await readJson(required('binding'), 16_384)) as ProposalQueueBinding;
      const destination = await prepareProposalQueueBackupOutput(required('output'));
      queue = new SqliteProposalQueue(path, binding, { readonly: true, existing: true });
      const backup = queue.backup();
      const reader = queue;
      queue = undefined;
      let exportPhase = 'close';
      let report: unknown;
      try {
        reader.close();
        exportPhase = 'save';
        const saved = await saveProposalQueueBackup(destination, backup);
        report = { ...proposalQueueBackupSummary(backup), close_state: 'closed', output: saved };
      } catch (error) {
        process.stderr.write(
          JSON.stringify(
            {
              code: 'PROPOSAL_QUEUE_BACKUP_EXPORT_FAILED',
              backup,
              output: {
                output_path: destination.path,
                export_phase: exportPhase,
                close_state: exportPhase === 'close' ? 'not-confirmed' : 'closed',
                ...(error instanceof ContractError ? error.envelope.details : {}),
              },
            },
            null,
            2,
          ) + '\n',
        );
        return 1;
      }
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      return 0;
    }
    if (command === 'receipt-record-recover') {
      const target = required('output');
      const recovery = await readProposalReceiptRecordRecovery(required('file'));
      const summary = proposalQueueReceiptRecordSummary(recovery.record);
      let outputPath = target;
      let exportPhase = 'prepare';
      let report: unknown;
      try {
        const destination = await prepareProposalReceiptRecordOutput(target);
        outputPath = destination.path;
        if (values.preview) {
          report = {
            ...summary,
            recovery_source: recovery.source,
            output: { state: 'preview', path: destination.path },
          };
        } else {
          exportPhase = 'save';
          const saved = await saveProposalQueueReceiptRecord(destination, recovery.record);
          report = { ...summary, recovery_source: recovery.source, output: saved };
        }
      } catch (error) {
        process.stderr.write(
          JSON.stringify(
            {
              code: 'PROPOSAL_RECEIPT_RECORD_EXPORT_FAILED',
              trace_id: recovery.record.result.trace_id,
              result: recovery.record.result,
              record: recovery.record,
              output: {
                output_path: outputPath,
                export_phase: exportPhase,
                ...(error instanceof ContractError ? error.envelope.details : {}),
              },
            },
            null,
            2,
          ) + '\n',
        );
        return 1;
      }
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      return 0;
    }
    if (command === 'inspect-receipt-record') {
      const record = await readProposalQueueReceiptRecord(required('file'));
      process.stdout.write(
        JSON.stringify(proposalQueueReceiptRecordSummary(record), null, 2) + '\n',
      );
      return 0;
    }
    if (command === 'generation-requests') {
      if (values.limit !== undefined && !/^[1-9]\d?$/.test(values.limit))
        throw new TypeError('Use a request limit between 1 and 20');
      const query = parseGenerationCatalogQuery({
        ...(values.limit === undefined ? {} : { limit: Number(values.limit) }),
        ...(values.state === undefined ? {} : { state: values.state }),
        ...(values.after === undefined ? {} : { after: values.after }),
      });
      const binding = (await readJson(required('binding'), 16_384)) as ProposalQueueBinding;
      const page = await listGenerationRequests(required('journal'), binding, query);
      process.stdout.write(JSON.stringify(page, null, 2) + '\n');
      return 0;
    }
    if (
      [
        'generation-request',
        'generation-run',
        'generation-status',
        'generation-result',
        'generation-recover',
      ].includes(command)
    ) {
      const key = required('key');
      validateGenerationRequestKey(key);
      const journal = required('journal');
      const binding = (await readJson(required('binding'), 16_384)) as ProposalQueueBinding;
      if (command === 'generation-recover') {
        const retained = await readJson(required('file'), GENERATION_RECOVERY_BYTES);
        const result = await recoverGenerationRequest(journal, binding, key, retained, {
          preview: values.preview === true,
        });
        process.stdout.write(
          JSON.stringify(
            {
              ...generationRequestSummary(result),
              preview: result.preview,
              action: result.action,
              replayed: result.replayed,
              outcome_origin: result.outcome_origin,
              result_state: result.result_state,
              outcome_sha256: result.outcome_sha256,
              result_record_sha256: result.result_record_sha256,
              result_failure: result.result_failure,
              result_finished_at: result.result_finished_at,
              ...('output' in result ? { output: result.output } : {}),
            },
            null,
            2,
          ) + '\n',
        );
        return 0;
      }
      if (command === 'generation-request') {
        const preparation = await readJson(required('file'), PROPOSAL_GENERATION_RECORD_BYTES);
        const provider = await readJson(required('provider'), 16_384);
        const saved = await prepareGenerationRequest(journal, binding, preparation, provider, key);
        process.stdout.write(
          JSON.stringify(
            {
              ...generationRequestSummary(saved),
              replayed: saved.replayed,
              ...('output' in saved ? { output: saved.output } : {}),
            },
            null,
            2,
          ) + '\n',
        );
        return 0;
      }
      if (command === 'generation-run') {
        const result = await runGenerationRequest(journal, binding, key, {
          api_key: process.env.PROPOSAL_GENERATION_API_KEY ?? '',
        });
        process.stdout.write(
          JSON.stringify(
            {
              ...generationRequestSummary(result),
              replayed: result.replayed,
              ...('claim' in result ? { claim: result.claim } : {}),
              ...('output' in result ? { output: result.output } : {}),
            },
            null,
            2,
          ) + '\n',
        );
        return result.state === 'failed' ? 1 : 0;
      }
      const output =
        command === 'generation-result'
          ? await prepareGenerationOutput(required('output'))
          : undefined;
      const state = await readGenerationRequest(journal, binding, key);
      if (!output) {
        process.stdout.write(JSON.stringify(generationRequestSummary(state), null, 2) + '\n');
        return 0;
      }
      const record = state.outcome?.record;
      if (!record)
        throw new ContractError(
          'PROPOSAL_GENERATION_REQUEST_RESULT_UNAVAILABLE',
          'No complete result is saved for this request',
          {
            request_id: state.request.request_id,
            request_key: key,
            request_sha256: state.request.sha256,
            state: state.state,
          },
        );
      try {
        const saved = await saveProposalGenerationRecord(output, record);
        process.stdout.write(
          JSON.stringify({ ...generationRequestSummary(state), output: saved }, null, 2) + '\n',
        );
      } catch (error) {
        process.stderr.write(
          JSON.stringify(
            {
              code: 'PROPOSAL_GENERATION_REQUEST_EXPORT_FAILED',
              ...generationRequestSummary(state),
              record,
              output: {
                output_path: output.path,
                ...(error instanceof ContractError ? error.envelope.details : {}),
              },
            },
            null,
            2,
          ) + '\n',
        );
        return 1;
      }
      return 0;
    }
    if (command === 'inspect-generation') {
      const record = inspectProposalGenerationRecord(
        await readJson(required('file'), PROPOSAL_GENERATION_RECORD_BYTES),
      );
      process.stdout.write(JSON.stringify(recordSummary(record), null, 2) + '\n');
      return 0;
    }
    if (command === 'prepare-generation') {
      const selection = parseProposalGenerationSelection(
        await readJson(required('file'), 32 * 1024),
      );
      const binding = (await readJson(required('binding'), 16_384)) as ProposalQueueBinding;
      const output = await prepareGenerationOutput(required('output'));
      const prepared = await prepareProposalGeneration(selection, binding, {
        access_token: process.env.PROPOSAL_WORKER_ACCESS_TOKEN ?? '',
      });
      let saved: Awaited<ReturnType<typeof savePreparedGeneration>>;
      let record: ProposalGenerationRecord | undefined;
      try {
        if (values.record) {
          record = createPreparedProposalRecord(prepared);
          saved = await saveProposalGenerationRecord(output, record);
        } else {
          saved = await savePreparedGeneration(output, prepared.input, prepared.trace_id);
        }
      } catch (error) {
        process.stderr.write(
          JSON.stringify(
            {
              code: 'PROPOSAL_SOURCE_PREPARATION_SAVE_FAILED',
              trace_id: prepared.trace_id,
              preparation: prepared,
              ...(record ? { record } : {}),
              output: {
                output_path: output.path,
                ...(error instanceof ContractError ? error.envelope.details : {}),
              },
            },
            null,
            2,
          ) + '\n',
        );
        return 1;
      }
      process.stdout.write(
        JSON.stringify(
          { ...prepared, ...(record ? { record_sha256: record.sha256 } : {}), output: saved },
          null,
          2,
        ) + '\n',
      );
      return 0;
    }
    if (command === 'generate' || command === 'generate-prepared') {
      const provider = parseProposalGenerationProvider(
        await readJson(required('provider'), 16_384),
      );
      const prepared =
        command === 'generate-prepared'
          ? inspectProposalGenerationRecord(
              await readJson(required('file'), PROPOSAL_GENERATION_RECORD_BYTES),
            )
          : undefined;
      if (prepared && prepared.kind !== 'proposal-preparation')
        throw new ContractError(
          'PROPOSAL_GENERATION_RECORD_INVALID',
          'A preparation record is required',
        );
      const input = prepared
        ? prepared.preparation.input
        : parseProposalGenerationRequest(await readJson(required('file'), 512 * 1024));
      const output = await prepareGenerationOutput(required('output'));
      const generated = await generateProposalDraft(input, provider, {
        api_key: process.env.PROPOSAL_GENERATION_API_KEY ?? '',
      });
      let saved: Awaited<ReturnType<typeof saveGeneratedDraft>>;
      let record: GeneratedProposalRecord | undefined;
      try {
        if (prepared) {
          record = createGeneratedProposalRecord(prepared, provider, generated);
          saved = await saveProposalGenerationRecord(output, record);
        } else {
          saved = await saveGeneratedDraft(output, generated.draft, generated.trace_id);
        }
      } catch (error) {
        // Preserve completed work even when sealing the record fails. Never include credentials.
        process.stderr.write(
          JSON.stringify(
            {
              code: 'PROPOSAL_GENERATION_SAVE_FAILED',
              trace_id: generated.trace_id,
              generation: generated,
              ...(prepared ? { preparation: prepared, provider } : {}),
              ...(record ? { record } : {}),
              output: {
                output_path: output.path,
                ...(error instanceof ContractError ? error.envelope.details : {}),
              },
            },
            null,
            2,
          ) + '\n',
        );
        return 1;
      }
      process.stdout.write(
        JSON.stringify(
          { ...(record ? recordSummary(record) : generated), output: saved },
          null,
          2,
        ) + '\n',
      );
      return 0;
    }
    const limit =
      values.limit === undefined ? (command === 'generation-list' ? 10 : 25) : Number(values.limit);
    if (values.limit !== undefined && (!/^[1-9]\d{0,2}$/.test(values.limit) || limit > 100))
      throw new TypeError('--limit must be between 1 and 100');
    // Validate inputs before creating/opening the queue file.
    const path = required('queue');
    const binding = (await readJson(required('binding'), 16_384)) as ProposalQueueBinding;
    const generatedRecord =
      command === 'enqueue-generated'
        ? inspectProposalGenerationRecord(
            await readJson(required('file'), PROPOSAL_GENERATION_RECORD_BYTES),
          )
        : undefined;
    const draft = generatedRecord
      ? readGeneratedProposalDraft(generatedRecord, binding)
      : command === 'enqueue'
        ? parseCreateProposal(await readJson(required('file'), 1_048_576))
        : undefined;
    const key =
      command === 'enqueue' || command === 'enqueue-generated' ? required('key') : undefined;
    if (key !== undefined) {
      validateIdempotencyKey(key);
      if (!/^[\x21-\x7e]{1,255}$/.test(key)) throw new TypeError('Invalid queue request key');
    }
    const id = [
      'get',
      'retry',
      'generation-list',
      'generation-get',
      'receipt',
      'reconcile',
    ].includes(command)
      ? required('id')
      : undefined;
    const historyQuery =
      command === 'generation-list'
        ? parseGenerationHistoryQuery({
            limit,
            ...(values.after === undefined ? {} : { after: values.after }),
          })
        : undefined;
    const digest = command === 'generation-get' ? required('sha256') : undefined;
    if (command === 'generation-get' || command === 'generation-list') {
      if (!isUlid(id)) throw new TypeError('Use a job ULID');
      if (digest !== undefined) validateGenerationDigest(digest);
    }
    const historyOutput =
      command === 'generation-get' && values.output !== undefined
        ? await prepareGenerationOutput(required('output'))
        : undefined;
    const receiptCommand = command === 'receipt' || command === 'reconcile';
    const receiptOutput =
      receiptCommand && values.output !== undefined
        ? await prepareProposalReceiptRecordOutput(required('output'))
        : undefined;
    const receiptTimeout =
      values['timeout-ms'] === undefined ? 30000 : Number(values['timeout-ms']);
    if (
      receiptCommand &&
      (!isUlid(id) ||
        !Number.isSafeInteger(receiptTimeout) ||
        receiptTimeout < 1 ||
        receiptTimeout > 2147483647 ||
        (values['timeout-ms'] !== undefined && !/^[1-9][0-9]{0,9}$/.test(values['timeout-ms'])))
    )
      throw new TypeError('Use a task ULID and receipt timeout');
    if (
      (command === 'flush' || receiptCommand) &&
      !process.env.PROPOSAL_WORKER_ACCESS_TOKEN?.trim()
    )
      throw new ContractError(
        'UNAUTHENTICATED',
        'Set PROPOSAL_WORKER_ACCESS_TOKEN before gateway queue operations',
      );
    queue = new SqliteProposalQueue(path, binding, {
      readonly: ['list', 'get', 'generation-list', 'generation-get', 'receipt'].includes(command),
      ...(receiptCommand ? { existing: true } : {}),
    });
    let output: unknown;
    let exitCode = 0;
    switch (command) {
      case 'enqueue':
        output = queue.enqueue(draft!, key!);
        break;
      case 'enqueue-generated':
        output = queue.enqueueGenerated(generatedRecord!, key!);
        break;
      case 'generation-list':
        output = queue.listGenerations(id!, historyQuery!);
        break;
      case 'generation-get': {
        const found = queue.getGeneration(id!, digest!);
        if (!historyOutput) {
          output = found;
          break;
        }
        const reader = queue;
        queue = undefined;
        let exportPhase = 'close';
        try {
          reader.close();
          exportPhase = 'save';
          const saved = await saveProposalGenerationRecord(historyOutput, found.record);
          output = {
            job_id: found.job_id,
            request_key: found.request_key,
            attached_at: found.attached_at,
            record_sha256: found.record.sha256,
            output: saved,
          };
        } catch (error) {
          process.stderr.write(
            JSON.stringify(
              {
                code: 'PROPOSAL_GENERATION_HISTORY_EXPORT_FAILED',
                ...found,
                output: {
                  output_path: historyOutput.path,
                  export_phase: exportPhase,
                  close_state: exportPhase === 'close' ? 'not-confirmed' : 'closed',
                  ...(error instanceof ContractError ? error.envelope.details : {}),
                },
              },
              null,
              2,
            ) + '\n',
          );
          return 1;
        }
        break;
      }
      case 'list':
        output = queue.list({
          limit,
          ...(values.before === undefined ? {} : { before: values.before }),
        });
        break;
      case 'get':
        output = queue.get(id!);
        break;
      case 'retry':
        output = queue.retry(id!);
        break;
      case 'receipt':
      case 'reconcile': {
        const result = await (
          command === 'receipt' ? readProposalQueueReceipt : reconcileProposalQueueJob
        )(queue, id!, {
          access_token: process.env.PROPOSAL_WORKER_ACCESS_TOKEN ?? '',
          timeout_ms: receiptTimeout,
        });
        output = result;
        exitCode =
          command === 'reconcile' &&
          !['submitted', 'already-submitted'].includes(result.local.state)
            ? 2
            : 0;
        break;
      }
      case 'flush': {
        const report = await flushProposalQueue(queue, {
          limit,
          access_token: () => process.env.PROPOSAL_WORKER_ACCESS_TOKEN ?? '',
        });
        output = report;
        exitCode = report.retry + report.blocked + report.lease_lost > 0 ? 2 : 0;
        break;
      }
    }
    if (receiptCommand) {
      const finished = queue;
      if (!finished) throw new Error('The receipt queue handle is unavailable');
      queue = undefined;
      try {
        finished.close();
      } catch {
        const result = output as ProposalQueueReceiptResult;
        throw new ProposalQueueReceiptError('PROPOSAL_RECEIPT_CLOSE_UNCONFIRMED', result.trace_id, {
          binding: result.binding,
          job_id: result.job_id,
          snapshot_sha256: result.snapshot_sha256,
          original: {
            identity: result.receipt.data.identity,
            request_key: result.receipt.data.request_key,
            draft: result.receipt.data.draft,
          },
          receipt: result.receipt,
          local: { mutation: result.local.mutation, phase: 'close' },
        });
      }
      output = { ...(output as ProposalQueueReceiptResult), close_state: 'closed' };
      if (receiptOutput) {
        const result = output as ProposalQueueReceiptRecord['result'];
        let record: ProposalQueueReceiptRecord | undefined;
        let exportPhase = 'record';
        try {
          record = createProposalQueueReceiptRecord(
            command === 'receipt' ? 'receipt' : 'reconcile',
            result,
          );
          exportPhase = 'save';
          const saved = await saveProposalQueueReceiptRecord(receiptOutput, record);
          output = { ...result, record_sha256: record.sha256, output: saved };
        } catch (error) {
          process.stderr.write(
            JSON.stringify(
              {
                code: 'PROPOSAL_RECEIPT_RECORD_EXPORT_FAILED',
                trace_id: result.trace_id,
                result,
                ...(record ? { record } : {}),
                output: {
                  output_path: receiptOutput.path,
                  export_phase: exportPhase,
                  ...(error instanceof ContractError ? error.envelope.details : {}),
                },
              },
              null,
              2,
            ) + '\n',
          );
          return 1;
        }
      }
    }
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    return exitCode;
  } catch (error) {
    if (error instanceof ProposalQueueReceiptError) {
      let close_state =
        error.envelope.code === 'PROPOSAL_RECEIPT_CLOSE_UNCONFIRMED' ? 'not-confirmed' : 'not-open';
      if (queue) {
        const failed = queue;
        queue = undefined;
        try {
          failed.close();
          close_state = 'closed';
        } catch {
          close_state = 'not-confirmed';
        }
      }
      process.stderr.write(
        JSON.stringify({ ...error.envelope, recovery: error.recovery, close_state }, null, 2) +
          '\n',
      );
      return 1;
    }
    if (error instanceof GenerationJournalWriteError) {
      process.stderr.write(
        JSON.stringify({ ...error.envelope, recovery: error.recovery }, null, 2) + '\n',
      );
      return 1;
    }
    // Never echo database contents, draft text, raw provider responses or credentials.
    const code =
      error instanceof ContractError
        ? error.envelope.code
        : error instanceof TypeError || error instanceof SyntaxError
          ? 'INVALID_INPUT'
          : 'PROPOSAL_QUEUE_COMMAND_FAILED';
    const sourceDetails: Record<string, unknown> = {};
    if (error instanceof ContractError && code.startsWith('PROPOSAL_GENERATION_REQUEST_')) {
      const details = error.envelope.details;
      for (const field of ['request_id', 'attempt_id'] as const)
        if (isUlid(details[field])) sourceDetails[field] = details[field];
      if (
        typeof details.request_key === 'string' &&
        /^[\x21-\x7e]{1,255}$/.test(details.request_key)
      )
        sourceDetails.request_key = details.request_key;
      if (
        typeof details.request_sha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(details.request_sha256)
      )
        sourceDetails.request_sha256 = details.request_sha256;
      if (
        typeof details.state === 'string' &&
        ['prepared', 'attempted', 'generated', 'failed'].includes(details.state)
      )
        sourceDetails.state = details.state;
    }
    if (error instanceof ContractError && code === 'PROPOSAL_GENERATION_ENQUEUE_FAILED') {
      const details = error.envelope.details;
      if (
        typeof details.request_key === 'string' &&
        /^[\x21-\x7e]{1,255}$/.test(details.request_key)
      )
        sourceDetails.request_key = details.request_key;
      if (typeof details.record_sha256 === 'string' && /^[a-f0-9]{64}$/.test(details.record_sha256))
        sourceDetails.record_sha256 = details.record_sha256;
      if (isUlid(details.candidate_job_id))
        sourceDetails.candidate_job_id = details.candidate_job_id;
      for (const [field, allowed] of [
        ['phase', ['begin', 'job', 'record', 'commit']],
        ['rollback', ['not-started', 'completed', 'not-confirmed']],
        ['mutation', ['not-started', 'rolled-back', 'not-confirmed']],
      ] as const) {
        const value = details[field];
        if (typeof value === 'string' && (allowed as readonly string[]).includes(value))
          sourceDetails[field] = value;
      }
    }
    if (error instanceof ContractError && code.startsWith('PROPOSAL_SOURCE_PREPARATION_')) {
      const details = error.envelope.details;
      if (typeof details.item_id === 'string' && details.item_id.length <= 255)
        sourceDetails.item_id = details.item_id;
      for (const field of ['expected_revision', 'current_revision'] as const) {
        const value = details[field];
        if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
          sourceDetails[field] = value;
      }
    }
    process.stderr.write(
      JSON.stringify({
        code,
        ...sourceDetails,
        message:
          'Proposal worker command failed. Check arguments, local file access and provider/gateway configuration; use --help for syntax.',
        ...(error instanceof ContractError
          ? {
              trace_id: error.envelope.trace_id,
              ...(error.envelope.details.provider_dispatch === undefined
                ? {}
                : { provider_dispatch: error.envelope.details.provider_dispatch }),
              ...(typeof error.envelope.details.cause_code === 'string' &&
              /^[A-Z][A-Z0-9_]{1,127}$/.test(error.envelope.details.cause_code)
                ? { cause_code: error.envelope.details.cause_code }
                : {}),
              ...(typeof error.envelope.details.status === 'number' &&
              Number.isInteger(error.envelope.details.status) &&
              error.envelope.details.status >= 100 &&
              error.envelope.details.status <= 599
                ? { status: error.envelope.details.status }
                : {}),
            }
          : {}),
      }) + '\n',
    );
    return 1;
  } finally {
    queue?.close();
  }
}

function recordSummary(record: ProposalGenerationRecord) {
  const prepared = record.kind === 'proposal-preparation' ? record : record.preparation;
  return {
    schema_version: record.schema_version,
    kind: record.kind,
    sha256: record.sha256,
    preparation_sha256: prepared.sha256,
    binding: prepared.preparation.binding,
    preparation_trace_id: prepared.preparation.trace_id,
    prepared_at: prepared.preparation.prepared_at,
    proposal_kind: prepared.preparation.input.kind,
    classification: prepared.preparation.input.classification,
    ttl_seconds: prepared.preparation.input.ttl_seconds,
    sources: prepared.preparation.observations,
    ...(record.kind === 'proposal-generation'
      ? {
          generation_trace_id: record.generation.trace_id,
          generated_at: record.generation.generated_at,
          provider: record.provider,
          requested_model: record.generation.requested_model,
          returned_model: record.generation.returned_model,
          prompt_version: record.generation.prompt_version,
          provider_response_id: record.generation.provider_response_id,
        }
      : {}),
    consistency: 'valid',
    authentication: 'not-verified',
    freshness: 'not-checked',
  };
}

async function readJson(path: string, maximum: number): Promise<unknown> {
  const file = await open(path, 'r');
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > maximum)
      throw new TypeError('JSON input file is too large or is not a regular file');
    // Bounded even if another process grows the file after stat.
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maximum) throw new TypeError('JSON input file is too large');
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true })
        .decode(buffer.subarray(0, length))
        .replace(/^\uFEFF/, ''),
    );
  } finally {
    await file.close();
  }
}
