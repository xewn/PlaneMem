import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ContractError,
  createUlid,
  isUlid,
  parseSyncUploadEvent,
  parseSyncCommandIdentity,
  validateIdempotencyKey,
  type Ulid,
} from '@planemem/contracts';
import type { OutboxScope } from '@planemem/context-bridge';
import { parseInputObject, usage } from './cli.js';
import { callGateway, callArtifactUpload, readReadiness } from './remote.js';
import { isArtifactUploadCommand, parseArtifactUploadArguments } from './artifact-upload.js';
import { callArtifactDownload, parseArtifactDownloadArguments } from './artifact-download.js';
import { callAudit, isAuditCommand } from './audit.js';
import { callAdminSnapshot } from './admin.js';
import { callSessionCommandContext } from './session-command-context.js';
import { callConflictCommandContext } from './conflict-command-context.js';
import { callSyncCommandContext } from './sync-command-context.js';
import { callSyncEventReceiptArguments } from './sync-event-receipt.js';
import { callSyncConsumerArguments, isSyncConsumerCommand } from './sync-consumer.js';
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
import {
  isInboxAcknowledgementCommand,
  callInboxAcknowledgementArguments,
} from './inbox-acknowledgement.js';
import { callOutboxReconcileArguments } from './outbox-reconcile.js';
import { inspectOutboxReceiptArguments } from './outbox-receipt-file.js';
import { isOutboxReadCommand, runOutboxReadArguments } from './outbox-read.js';
import { callConflictSubmission } from './conflict-submission.js';
import { callConflictPreparation } from './conflict-preparation.js';
import { callConflictReceiptArguments } from './conflict-receipt.js';

const help = `workctx <command> [--json OBJECT | --json-file PATH] [--key KEY]

  inbox init                     Create a new local --inbox FILE; no network or implicit upgrade
  inbox import                   Import one --page-file into --inbox, advancing its continuous received cursor
  inbox status                   Read --inbox consumer state with expected_identity JSON or --json-file
  inbox consumers                Discover stored identities/state using --json '{}' or limit/after_consumer_key JSON
  inbox export-pages             Export the complete consumer page chain using identity JSON and --output NEW_ARCHIVE
  inbox inspect-pages            Inspect --archive-file offline; no inbox or network
  inbox archive-history          Browse --archive-file page summaries using JSON; continuations bind the archive digest
  inbox archive-page             Read archive/page digest selection JSON; optionally extract to --output NEW_PAGE
  inbox restore-pages            Atomically restore --archive-file into an existing --inbox; no merge or overwrite
  inbox compare-pages            Compare --archive-file with --inbox; optional --output NEW_QUERY saves the exact append_query
  inbox append-pages             Append a verified archive suffix using --inbox, --archive-file and saved append_query JSON
  inbox audit-pages              Audit the complete consumer page chain; expected_identity and optional max_pages JSON
  inbox page-history             List validated historical page summaries using identity/history JSON
  inbox page-get                 Read identity/document_sha256 selection; optional --output NEW_PAGE.json
  inbox head                     Export that consumer's stored head to --output NEW_PAGE.json
  inbox enable-ack               Explicitly add the local acknowledgement journal to --inbox
  inbox enable-ack-dispatch      Explicitly add the dispatch journal after enable-ack
  inbox enable-ack-recovery      Explicitly add recovery provenance after enable-ack-dispatch
  inbox enable-applications      Explicitly add local projection storage to an existing --inbox
  inbox application-status       Read a local projection using --inbox and --json/--json-file
                                 Requires expected_identity and application name/version; optional JSON timeout_ms
  inbox application-apply        Apply one imported page with the built-in context-item-lifecycle/1 adapter
                                 JSON also requires document_sha256 and expected_previous_sha256 (null for root)
  inbox application-audit        Audit the selected application's entire saved history without running reducers
                                 JSON: expected_identity/application; optional max_pages/max_events/max_bytes/timeout_ms
  inbox application-replay       Recompute every saved context-item-lifecycle/1 projection without writing
                                 Same audit JSON budgets plus optional max_replay_bytes; --inbox required
  inbox application-list         List saved applications and checkpoint summaries for the original identity
                                 JSON: expected_identity; optional limit (1–50), after_application_key, timeout_ms
  inbox application-export       Save full audited application history to --output NEW_FILE using --inbox and original application JSON
  inbox application-restore      Restore source pages and an empty/identical application using --inbox, --archive-file and original identity/application/archive digest JSON
  inbox application-restore-preview  Preview compatibility and planned counts readonly using the same inbox/archive/query options
                                  Preview restore_query binds expected_target; changed histories are rejected before any restore writes
  inbox application-inspect      Inspect --archive-file offline; optional JSON limit/after_sequence/archive_document_sha256
  inbox application-archive-get  Read an archived projection using --archive-file and archive/page digest JSON
  inbox application-history      Page application summaries with fixed sequence/page/projection boundaries
  inbox application-get          Read a saved projection selected by document_sha256; optional expected_projection_sha256
                                 Both require --inbox and original identity/application JSON; history accepts limit 1–50
  inbox ack-status               Read latest original acknowledgement using expected_identity JSON
  inbox ack-dispatch-status      Read latest target and dispatch using expected_identity JSON
  inbox ack-history              Page original acknowledgement summaries using identity/history JSON
  inbox ack-audit                Audit enabled acknowledgement journals using identity and optional max_entries JSON
  inbox ack-get                  Read a complete original record using identity/record_id JSON
  inbox ack-dispatch-history     Page dispatch summaries; optional record_id in identity/history JSON
  inbox ack-dispatch-get         Read a complete dispatch and original record using identity/dispatch_id JSON
  inbox ack-recovery-get         Read recovery provenance and its first local dispatch using identity/record_id JSON
                                 get commands may save with --output NEW_FILE; recovery-get produces archive v2
  inbox ack-evidence-inspect     Inspect --evidence-file SAVED.json offline without opening an inbox
  inbox ack-evidence-page        Extract its original page to --output NEW_PAGE.json; no database or network
  inbox ack-result-inspect       Inspect a captured server result using --result-file SAVED.json offline
  inbox ack-result-page          Extract its original page to --output NEW_PAGE.json without journal updates
  inbox ack                      Journal then acknowledge an imported --page-file; requires --inbox
  inbox ack-observe              Read current server cursor for the unresolved original page; never resends
  inbox ack-retry                Retry the original page with required --dispatch-id LATEST_ID
  inbox ack-recover              Send a legacy target without dispatch history; requires --record-id ORIGINAL_ID
                                 ack/ack-retry/ack-recover/ack-observe use --inbox, --page-file and optional --timeout-ms
                                 Optional --result-output NEW_FILE preserves a new complete result even if journaling fails
  outbox enqueue                 Queue event_id, event_type, payload and saved expected_identity offline
  outbox list                    Read a metadata page from an existing queue; optional JSON status/limit/after_event_id
  outbox get EVENT_ID            Read and validate one complete original record without sending
  outbox retry EVENT_ID          Schedule another attempt for a pending or failed event
  outbox reconcile EVENT_ID      Confirm original delivery and settle this local row
                                 Optional --result-output NEW_FILE saves the complete validated receipt
  outbox inspect-result          Read and verify --result-file offline; no queue or network
                                 Optional --outbox EXISTING_FILE and --timeout-ms; never resends
  sync [flush] [--limit 1-100]   Upload one due batch (default: 50 events)
  sync changes                   Read one complete page; optional cursor/limit/expected_identity JSON
                                 --output NEW_PAGE.json saves a page with explicit original identity/cursor
  sync inspect                   Inspect an existing --page-file offline and show recovery parameters
  sync cursor                    Read current acknowledgement; optional expected_identity JSON
  sync ack                       Acknowledge saved expected_identity/cursor JSON after local persistence
                                 changes/cursor/ack accept --json, --json-file or --page-file and --timeout-ms
                                 --page-file derives continuation/identity/ack from a verified saved page; no stdin or --key
  sync identity                  Read verified original sender; optional --timeout-ms, no JSON or --key
  sync receipt                   Read original identity/event with --json-file or --json; optional --timeout-ms, no --key
  sessions list                  Read one session page; query/status/client_id/limit/cursor JSON, no --key
  sessions identity              Read verified caller identity and permission hints; optional --timeout-ms, no JSON or --key
  sessions get                   Read current status, version and ended_at for session_id; no --key
  admin snapshot                 Read project administration counts/observations; optional --timeout-ms, no JSON or --key
  audit list                     Read one audit page; optional exact resource/trace_id/action/audit_id/session_id/cursor JSON
  audit get                      Read one audit_id; save and review the returned JSON before export
  audit export                   Export --json-file REVIEWED_SINGLE_RECORD.json --reviewed --output NEW_FILE
                                 Optional --timeout-ms; no --key, inline export JSON or automatic retries
  artifacts get                  Read current metadata by artifact_id; no bytes or --key
  artifacts version              Read historical metadata by artifact_id and positive version; no --key
  artifacts receipt              Query the original write with saved identity and command JSON; no --key
  artifacts create               Upload --json-file ORIGINAL.json --file CONTENT; no --json or --key
  artifacts put-version          Append with the same saved request/file inputs and original version
                                 Optional --max-bytes (default 67108864), --timeout-ms (default 180000)
  artifacts download             Download artifact_id/version JSON to --output NEW_FILE; no overwrite or --key
                                 Optional --max-bytes (default 67108864), --timeout-ms (default 180000)
  overview                       Read project totals and limited previews of saved records
  observed project               Read the current project's saved Plane observation
  observed list                  Search saved Plane metadata; query/state/limit/cursor in JSON
  observed work-item             Read a saved Plane work item by work_item_id (external or aggregate ID)
  observed context               Read the same work item with a context summary and optional memory
  plane-events list              Admin: list event processing metadata; status/pending_state/aggregate_id/limit/cursor in JSON
  plane-events summary           Admin: read visible project-wide queue counts and pending timestamps; no input fields or key
  plane-events get               Admin: read one event processing receipt by event_id in JSON
  plane-events diagnose          Admin: compare committed versions and visible candidate receipts by event_id; read-only
  plane-events retry             Human admin: schedule event_id with string expected_revision, reason,
                                 expected_actor_id/expected_client_id and request_key (or --key)
  plane-events retry-receipt     Read the original retry outcome using the same JSON and request_key;
                                 no --key, no scheduling; not-observed does not prove failure
  search                         Search saved project records; JSON query required, optional type/mode/limit/cursor
  work-items get                 Read a saved local work item by item_id, with version and sources
  work-items list                List saved work items; optional query, status, cursor and limit
  sessions start                 Start with original expected_identity and optional parent/actor/client in JSON, plus --key
  sessions start-receipt         Query original start with expected_identity, request_key and original session JSON; no --key
  sessions end                   End session_id with original expected_identity, status, expected_version and --key
  sessions receipt               Query original run start/finish, tool or end outcome with session_id, operation,
                                 expected_identity, request_key and command JSON (including original expected_version); no --key
                                 For run.finish also preserve original run_id and expected_run_version
                                 For tool.finish also preserve original tool_call_id and expected_tool_version
  runs start                     Start an agent run with session_id, expected_identity, expected_version and --key
  runs finish                    Record completed/failed with expected_identity, session_id, run_id, status,
                                 expected_version, expected_run_version and --key
  runs list                      Read session_id runs; optional before_sequence and limit
  runs get                       Read one run with session_id and run_id, including both versions
  tool-calls list                Read session_id tool calls; optional run_id, before_id and limit
  tool-calls get                 Read one tool call with session_id and tool_call_id
  tool-calls record              Record a tool call with session_id, run_id, tool_name, status,
                                 expected_identity, expected_version and --key
  tool-calls finish              Record succeeded/failed with expected_identity, session_id, tool_call_id, status,
                                 expected_version, expected_tool_version and --key
  handoffs list                  Read one handoff page; query/status/session_id/origin/limit/cursor JSON, no --key
  handoff                       Create with session_id, checkpoint_id, expected_identity and --key
  handoff receipt               Query original creation with session_id, request_key, handoff and expected_identity
  handoff claim                  Claim with original expected_identity, expected_version and --key
  handoff claim-receipt          Query original claim with request_key, claim and expected_identity
  checkpoints list               Read one project page: query/checkpoint_id/limit/cursor; no --key
                                 Or only session_id/before_revision for session history
  checkpoints get                Read one historical checkpoint with session_id and checkpoint_id; no --key
  checkpoints history            Read ten saved revisions for session_id; optional before_revision; no --key
  handoffs get                   Read current handoff ownership with handoff_id; no --key
  checkpoint                     Save six original note arrays with session_id, expected_identity, expected_version and --key
  checkpoint receipt             Read original save with session_id, expected_identity, request_key and checkpoint JSON; no --key
  resume receipt                 Read original resume with session_id, handoff_id, expected_identity and request_key; no --key
  resume                         Resume with session_id, handoff_id, expected_identity and --key; no version condition
                                 Preserve effective require_claimed and optional expected_checkpoint_id for both commands
  conflicts                      Read one metadata page; query/status/entity_type/conflict_id/limit/cursor JSON, no --key
  conflicts get                  Read conflict_id independently; complete values and decimal-string versions, no --key
  conflicts receipt              Check --json-file ORIGINAL.json or --json ORIGINAL; optional --timeout-ms, no --key
  conflicts identity             Read verified conflict operation identity; only optional --timeout-ms
  conflicts submit               Submit saved ORIGINAL.json with --json-file and --reviewed; outcome still needs receipt lookup
  conflicts prepare              Save a new original with --json-file DECISION.json --output NEW_ORIGINAL.json; never sends the decision
  conflicts resolve              Resolve conflict_id with expected_version and --key
  doctor                         Read gateway readiness
  context compile                Save a context pack; optional budget_tokens/ttl_seconds and --key
  context get                    Read a pack; optional pack_id and format (json/markdown/mcp)
  context create                 Add proposed context; title/content/source_refs and --key
  context read                   Read a source item by item_id
  context list                   Filter current source items by query/layer/classification/status/item_type
  context update                 Edit item_id with expected_version and --key
  context archive                Archive item_id with expected_version and --key
  context read-archived          Read an archived item_id
  context restore                Restore item_id as excluded with expected_version and --key
  context confirm                Human confirmation: item_id/expected_version/reason and --key
  context history                List recorded item_id versions; optional before_version/limit
  context version                Read a recorded snapshot by item_id and version
  index status                   Read legacy index metadata by id, including deletion/expiry
  index list                     List legacy index metadata; query/state/managed_by/limit/cursor
  index delete                   Soft-delete manual index: id/expected_revision/reason and --key
  index restore                  Restore manual index without extending expiry; same fields and --key
  proposals create               Submit a sourced proposal with --key
  proposals list                 List proposals; optional status/kind/before/limit
  proposals get                  Read proposal_id with provenance and source freshness
  proposals confirm              Human review: proposal_id/expected_revision/reason and --key
  proposals reject               Human review: proposal_id/expected_revision/reason and --key

Use --json - to read JSON from stdin. Set WORKCTX_TENANT_ID, WORKCTX_WORKSPACE_ID
and WORKCTX_PROJECT_ID for project commands. Network commands use WORKCTX_URL
(default http://127.0.0.1:3000) and WORKCTX_ACCESS_TOKEN. Doctor only needs the URL.
WORKCTX_OUTBOX or --outbox selects the SQLite file (default ~/.workctx/outbox.sqlite).`;

function parseOptions(args: string[]) {
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      tokens: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'string' },
        'json-file': { type: 'string' },
        'page-file': { type: 'string' },
        'archive-file': { type: 'string' },
        'evidence-file': { type: 'string' },
        'result-file': { type: 'string' },
        'result-output': { type: 'string' },
        'dispatch-id': { type: 'string' },
        'record-id': { type: 'string' },
        file: { type: 'string' },
        output: { type: 'string' },
        'max-bytes': { type: 'string' },
        'timeout-ms': { type: 'string' },
        reviewed: { type: 'boolean' },
        key: { type: 'string' },
        outbox: { type: 'string' },
        inbox: { type: 'string' },
        limit: { type: 'string' },
      },
    });
  } catch (error) {
    return usage(error instanceof Error ? error.message : 'Invalid arguments');
  }
}

function jsonInput(raw?: string, file?: string): Record<string, unknown> {
  if (raw !== undefined && file !== undefined) usage('Choose --json or --json-file');
  if (file === undefined && raw === undefined) return {};
  const source =
    file !== undefined ? readFileSync(file, 'utf8') : raw === '-' ? readFileSync(0, 'utf8') : raw!;
  return parseInputObject(source);
}

function envId(name: string): Ulid {
  const value = process.env[name];
  if (!isUlid(value)) usage(name + ' must contain a ULID');
  return value;
}

function token(): string {
  return (
    process.env.WORKCTX_ACCESS_TOKEN?.trim() || usage('Set WORKCTX_ACCESS_TOKEN to use the gateway')
  );
}

function requestKey(
  option: string | undefined,
  input: Record<string, unknown>,
): string | undefined {
  if (
    option !== undefined &&
    input.idempotency_key !== undefined &&
    option !== input.idempotency_key
  )
    usage('--key and idempotency_key disagree');
  const key = option ?? input.idempotency_key;
  if (key === undefined) return undefined;
  try {
    return validateIdempotencyKey(key);
  } catch {
    return usage('Invalid idempotency key');
  }
}

function print(value: unknown) {
  process.stdout.write(JSON.stringify(value) + '\n');
}

export async function main(args: string[]): Promise<number> {
  const trace = 'trace_cli_' + createUlid();
  try {
    const { positionals, values, tokens } = parseOptions(args);
    if (values.help) {
      process.stdout.write(help + '\n');
      return 0;
    }
    const [command, action, id] = positionals;
    const name =
      command === 'sync' && action === undefined
        ? 'sync flush'
        : [command, action].filter(Boolean).join(' ');
    const known = [
      'inbox init',
      'inbox import',
      'inbox status',
      'inbox consumers',
      'inbox export-pages',
      'inbox inspect-pages',
      'inbox archive-history',
      'inbox archive-page',
      'inbox restore-pages',
      'inbox compare-pages',
      'inbox append-pages',
      'inbox audit-pages',
      'inbox page-history',
      'inbox page-get',
      'inbox head',
      'inbox enable-ack',
      'inbox enable-ack-dispatch',
      'inbox enable-ack-recovery',
      'inbox enable-applications',
      'inbox application-status',
      'inbox application-list',
      'inbox application-export',
      'inbox application-restore',
      'inbox application-restore-preview',
      'inbox application-inspect',
      'inbox application-archive-get',
      'inbox application-apply',
      'inbox application-audit',
      'inbox application-replay',
      'inbox application-history',
      'inbox application-get',
      'inbox ack-status',
      'inbox ack-dispatch-status',
      'inbox ack-history',
      'inbox ack-audit',
      'inbox ack-get',
      'inbox ack-dispatch-history',
      'inbox ack-dispatch-get',
      'inbox ack-recovery-get',
      'inbox ack-evidence-inspect',
      'inbox ack-evidence-page',
      'inbox ack-result-inspect',
      'inbox ack-result-page',
      'inbox ack',
      'inbox ack-retry',
      'inbox ack-recover',
      'inbox ack-observe',
      'outbox enqueue',
      'outbox list',
      'outbox get',
      'outbox retry',
      'outbox reconcile',
      'outbox inspect-result',
      'sync flush',
      'sync changes',
      'sync inspect',
      'sync cursor',
      'sync ack',
      'checkpoint',
      'checkpoint receipt',
      'handoff',
      'handoff receipt',
      'resume',
      'resume receipt',
      'conflicts',
      'conflicts resolve',
      'conflicts get',
      'conflicts receipt',
      'conflicts identity',
      'sync identity',
      'sync receipt',
      'conflicts submit',
      'conflicts prepare',
      'doctor',
      'admin snapshot',
      'sessions identity',
      'sessions list',
      'audit list',
      'audit get',
      'audit export',
      'overview',
      'observed project',
      'observed list',
      'observed work-item',
      'observed context',
      'plane-events list',
      'plane-events summary',
      'plane-events get',
      'plane-events diagnose',
      'plane-events retry',
      'plane-events retry-receipt',
      'search',
      'index status',
      'index list',
      'index delete',
      'index restore',
      'work-items get',
      'work-items list',
      'sessions start',
      'sessions get',
      'artifacts get',
      'artifacts version',
      'artifacts receipt',
      'artifacts create',
      'artifacts put-version',
      'artifacts download',
      'sessions start-receipt',
      'sessions end',
      'sessions receipt',
      'runs start',
      'runs finish',
      'runs list',
      'runs get',
      'tool-calls list',
      'tool-calls get',
      'tool-calls record',
      'tool-calls finish',
      'handoffs list',
      'handoffs get',
      'handoff claim',
      'handoff claim-receipt',
      'checkpoints list',
      'checkpoints get',
      'checkpoints history',
      'context compile',
      'context get',
      'context create',
      'context read',
      'context list',
      'context update',
      'context archive',
      'context read-archived',
      'context restore',
      'context confirm',
      'context history',
      'context version',
      'proposals create',
      'proposals list',
      'proposals get',
      'proposals confirm',
      'proposals reject',
    ];
    if (
      !known.includes(name) ||
      (['outbox retry', 'outbox reconcile', 'outbox get'].includes(name)
        ? positionals.length !== 3
        : positionals.length > 2)
    )
      usage('Unknown or incomplete command. Run workctx --help');
    if (isInboxApplicationArchiveCommand(name)) {
      print(await runInboxApplicationArchiveArguments(args, trace));
      return 0;
    }
    if (isInboxPageChainCommand(name)) {
      print(await runInboxPageChainArguments(args, trace));
      return 0;
    }
    if (values['archive-file'] !== undefined)
      usage(
        '--archive-file is only for inbox inspect-pages/archive-history/archive-page/restore-pages/compare-pages/append-pages/application-inspect/application-archive-get/application-restore/application-restore-preview',
      );
    if (isInboxAckResultCommand(name)) {
      print(await runSyncAckResultArguments(args, trace));
      return 0;
    }
    if (name === 'outbox inspect-result') {
      print(await inspectOutboxReceiptArguments(args, trace));
      return 0;
    }
    if (values['result-file'] !== undefined)
      usage(
        '--result-file is only for inbox ack-result-inspect/ack-result-page or outbox inspect-result',
      );
    if (isInboxAckEvidenceCommand(name)) {
      print(await runSyncAckEvidenceArguments(args, trace));
      return 0;
    }
    if (values['evidence-file'] !== undefined)
      usage('--evidence-file is only for inbox ack-evidence-inspect/ack-evidence-page');
    if (isInboxAcknowledgementCommand(name)) {
      const result = await callInboxAcknowledgementArguments(args, {
        base: process.env.WORKCTX_URL ?? 'http://127.0.0.1:3000',
        token: token(),
        trace,
        scope: {
          tenant_id: envId('WORKCTX_TENANT_ID'),
          workspace_id: envId('WORKCTX_WORKSPACE_ID'),
          project_id: envId('WORKCTX_PROJECT_ID'),
        },
      });
      print(result);
      return result.data.record.state === 'unconfirmed' ? 1 : 0;
    }
    if (values['result-output'] !== undefined && name !== 'outbox reconcile')
      usage(
        '--result-output is only for inbox ack/ack-retry/ack-recover/ack-observe or outbox reconcile',
      );
    if (values['dispatch-id'] !== undefined) usage('--dispatch-id is only for inbox ack-retry');
    if (values['record-id'] !== undefined) usage('--record-id is only for inbox ack-recover');
    if (isInboxAckHistoryCommand(name)) {
      print(await runInboxAckHistoryArguments(args, trace));
      return 0;
    }
    if (isInboxCommand(name)) {
      print(await runInboxArguments(args, trace));
      return 0;
    }
    if (values.inbox !== undefined) usage('--inbox is only for inbox commands');
    if (name === 'sync inspect') {
      print(await inspectSyncPageArguments(args, trace));
      return 0;
    }
    if (values['page-file'] !== undefined && !isSyncConsumerCommand(name))
      usage('--page-file is only for sync changes/cursor/ack/inspect');
    if (isOutboxReadCommand(name)) {
      print(
        await runOutboxReadArguments(
          args,
          {
            tenant_id: envId('WORKCTX_TENANT_ID'),
            workspace_id: envId('WORKCTX_WORKSPACE_ID'),
            project_id: envId('WORKCTX_PROJECT_ID'),
          },
          trace,
        ),
      );
      return 0;
    }
    if (name === 'outbox reconcile') {
      const result = await callOutboxReconcileArguments(args, {
        base: process.env.WORKCTX_URL ?? 'http://127.0.0.1:3000',
        token: token(),
        trace,
        scope: {
          tenant_id: envId('WORKCTX_TENANT_ID'),
          workspace_id: envId('WORKCTX_WORKSPACE_ID'),
          project_id: envId('WORKCTX_PROJECT_ID'),
        },
      });
      print(result);
      return result.data.receipt.data.status === 'recorded' ? 0 : 1;
    }
    if (
      name === 'admin snapshot' ||
      name === 'sessions identity' ||
      name === 'conflicts identity' ||
      name === 'sync identity'
    ) {
      const call =
        name === 'admin snapshot'
          ? callAdminSnapshot
          : name === 'sync identity'
            ? callSyncCommandContext
            : name === 'conflicts identity'
              ? callConflictCommandContext
              : callSessionCommandContext;
      print(
        await call(args, {
          base: process.env.WORKCTX_URL ?? 'http://127.0.0.1:3000',
          token: token(),
          trace,
          scope: {
            tenant_id: envId('WORKCTX_TENANT_ID'),
            workspace_id: envId('WORKCTX_WORKSPACE_ID'),
            project_id: envId('WORKCTX_PROJECT_ID'),
          },
        }),
      );
      return 0;
    }
    if (isSyncConsumerCommand(name)) {
      print(
        await callSyncConsumerArguments(args, {
          base: process.env.WORKCTX_URL ?? 'http://127.0.0.1:3000',
          token: token(),
          trace,
          scope: {
            tenant_id: envId('WORKCTX_TENANT_ID'),
            workspace_id: envId('WORKCTX_WORKSPACE_ID'),
            project_id: envId('WORKCTX_PROJECT_ID'),
          },
        }),
      );
      return 0;
    }
    if (name === 'sync receipt') {
      print(
        await callSyncEventReceiptArguments(args, {
          base: process.env.WORKCTX_URL ?? 'http://127.0.0.1:3000',
          token: token(),
          trace,
          scope: {
            tenant_id: envId('WORKCTX_TENANT_ID'),
            workspace_id: envId('WORKCTX_WORKSPACE_ID'),
            project_id: envId('WORKCTX_PROJECT_ID'),
          },
        }),
      );
      return 0;
    }
    if (
      name === 'conflicts submit' ||
      name === 'conflicts prepare' ||
      (name === 'conflicts receipt' && values.json !== '-')
    ) {
      const call =
        name === 'conflicts prepare'
          ? callConflictPreparation
          : name === 'conflicts receipt'
            ? callConflictReceiptArguments
            : callConflictSubmission;
      print(
        await call(args, {
          base: process.env.WORKCTX_URL ?? 'http://127.0.0.1:3000',
          token: token(),
          trace,
          scope: {
            tenant_id: envId('WORKCTX_TENANT_ID'),
            workspace_id: envId('WORKCTX_WORKSPACE_ID'),
            project_id: envId('WORKCTX_PROJECT_ID'),
          },
        }),
      );
      return 0;
    }
    if (isAuditCommand(name)) {
      print(
        await callAudit(args, {
          base: process.env.WORKCTX_URL ?? 'http://127.0.0.1:3000',
          token: token(),
          trace,
          scope: {
            tenant_id: envId('WORKCTX_TENANT_ID'),
            workspace_id: envId('WORKCTX_WORKSPACE_ID'),
            project_id: envId('WORKCTX_PROJECT_ID'),
          },
        }),
      );
      return 0;
    }
    if (values.reviewed !== undefined) usage('--reviewed is only for audit export');
    if (name === 'artifacts download') {
      const download = parseArtifactDownloadArguments(args, trace);
      print(
        await callArtifactDownload(download, {
          base: process.env.WORKCTX_URL ?? 'http://127.0.0.1:3000',
          token: token(),
          trace,
          scope: {
            tenant_id: envId('WORKCTX_TENANT_ID'),
            workspace_id: envId('WORKCTX_WORKSPACE_ID'),
            project_id: envId('WORKCTX_PROJECT_ID'),
          },
        }),
      );
      return 0;
    }
    if (isArtifactUploadCommand(name)) {
      const upload = parseArtifactUploadArguments(args, trace);
      const scope: OutboxScope = {
        tenant_id: envId('WORKCTX_TENANT_ID'),
        workspace_id: envId('WORKCTX_WORKSPACE_ID'),
        project_id: envId('WORKCTX_PROJECT_ID'),
      };
      print(
        await callArtifactUpload(upload, {
          base: process.env.WORKCTX_URL ?? 'http://127.0.0.1:3000',
          token: token(),
          scope,
          trace,
          key: undefined,
        }),
      );
      return 0;
    }
    if (
      values.file !== undefined ||
      values.output !== undefined ||
      values['max-bytes'] !== undefined ||
      values['timeout-ms'] !== undefined
    )
      usage(
        '--file, --output, --max-bytes and --timeout-ms are only for the corresponding artifact upload/download commands',
      );
    const local = name.startsWith('outbox ') || name === 'sync flush';
    if (
      [
        'plane-events retry',
        'plane-events retry-receipt',
        'handoff claim',
        'handoff claim-receipt',
        'handoff',
        'handoff receipt',
        'sessions start',
        'sessions get',
        'sessions list',
        'conflicts',
        'conflicts get',
        'conflicts receipt',
        'handoffs list',
        'checkpoints list',
        'artifacts get',
        'artifacts version',
        'artifacts receipt',
        'checkpoint',
        'checkpoint receipt',
        'checkpoints get',
        'checkpoints history',
        'handoffs get',
        'resume',
        'resume receipt',
        'sessions start-receipt',
        'runs start',
        'tool-calls record',
        'sessions receipt',
        'runs finish',
        'tool-calls finish',
        'sessions end',
      ].includes(name)
    ) {
      const seen = new Set<string>();
      for (const token of tokens) {
        if (token.kind !== 'option') continue;
        if (seen.has(token.name)) usage('Command options must not be repeated');
        seen.add(token.name);
      }
    }
    if (values.limit !== undefined && name !== 'sync flush') usage('--limit is for sync flush');
    if (
      ['conflicts', 'conflicts get', 'conflicts receipt'].includes(name) &&
      values.reviewed !== undefined
    )
      usage('--reviewed is not a conflict read option');
    if (values.outbox !== undefined && !local) usage('--outbox is for local queue commands');
    const input = jsonInput(values.json, values['json-file']);
    if (['doctor', 'outbox retry', 'sync flush'].includes(name) && Object.keys(input).length)
      usage(name + ' does not take a JSON body');
    const key = requestKey(values.key, input);
    const base = process.env.WORKCTX_URL ?? 'http://127.0.0.1:3000';
    if (name === 'doctor') {
      const report = await readReadiness(base, trace);
      print(report);
      return report.data.ready ? 0 : 1;
    }
    const scope: OutboxScope = {
      tenant_id: envId('WORKCTX_TENANT_ID'),
      workspace_id: envId('WORKCTX_WORKSPACE_ID'),
      project_id: envId('WORKCTX_PROJECT_ID'),
    };
    for (const field of ['tenant_id', 'workspace_id', 'project_id'] as const)
      if (input[field] !== undefined && input[field] !== scope[field])
        usage(field + ' does not match the configured project');
    if (!local) {
      print(await callGateway(name, input, { base, token: token(), scope, trace, key }));
      return 0;
    }
    const path =
      values.outbox ?? process.env.WORKCTX_OUTBOX ?? join(homedir(), '.workctx', 'outbox.sqlite');
    if (!path.trim() || path === ':memory:') usage('Set a persistent SQLite file path');
    const limit = values.limit === undefined ? 50 : Number(values.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      usage('--limit must be between 1 and 100');
    const accessToken = name === 'sync flush' ? token() : '';
    const { SqliteOutbox, createGatewayPublisher } = await import('@planemem/context-bridge');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const queue = new SqliteOutbox(path);
    try {
      let data: unknown;
      let exitCode = 0;
      if (name === 'outbox retry') data = queue.retry(id!, trace, scope);
      else if (name === 'outbox enqueue') {
        if (input.actor_id !== undefined || input.client_id !== undefined)
          usage(
            'Supply the saved expected_identity; the gateway verifies its actor and client during sync',
          );
        let expected_identity;
        try {
          expected_identity = parseSyncCommandIdentity(input.expected_identity);
        } catch {
          usage(
            'Include the original expected_identity from sync identity; never replace an unknown sender with the current account',
          );
        }
        const event = parseSyncUploadEvent(input);
        if (!event)
          usage('Expected a valid event_id, event_type, payload and optional sync metadata');
        data = queue.enqueueDurably({
          ...event,
          ...scope,
          idempotency_key: key ?? event.event_id,
          trace_id: trace,
          expected_identity,
        });
      } else {
        const publish = createGatewayPublisher({
          gatewayUrl: base,
          accessToken: () => accessToken,
          traceId: trace,
        });
        const receipt = await queue.drainBatch(scope, publish, new Date(), limit);
        data = receipt;
        if (receipt.failed.length || receipt.retried.length || receipt.conflicts.length)
          exitCode = 1;
      }
      print({
        schema_version: 1,
        scope,
        data,
        trace_id: trace,
        source_refs: [{ type: 'outbox', id: scope.project_id }],
      });
      return exitCode;
    } finally {
      queue.close();
    }
  } catch (error) {
    const envelope =
      error instanceof ContractError
        ? error.envelope
        : new ContractError(
            'CLI_ERROR',
            error instanceof Error ? error.message : 'Command failed',
            { trace_id: trace },
          ).envelope;
    process.stderr.write(
      JSON.stringify({
        ...envelope,
        trace_id: envelope.trace_id === 'trace_unknown' ? trace : envelope.trace_id,
      }) + '\n',
    );
    return envelope.code === 'USAGE_ERROR' ? 2 : 1;
  }
}
