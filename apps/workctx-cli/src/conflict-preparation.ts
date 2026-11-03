import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  ContractError,
  createUlid,
  conflictReceiptJson,
  parseConflictReceiptQuery,
  type ConflictCommandContextEnvelope,
} from '@planemem/contracts';
import type { CommandRouter, RequestContext } from '@planemem/api-gateway';
import { prepareArtifactOutput, saveArtifactOutput } from './artifact-output.js';
import { readConflictJsonFile, readConflictOriginalFile } from './conflict-files.js';
import {
  callConflictCommandContext,
  runConflictCommandContext,
} from './conflict-command-context.js';

function invalid(trace: string) {
  return new ContractError(
    'USAGE_ERROR',
    'Use conflicts prepare --json-file DECISION.json --output NEW_ORIGINAL.json with optional --timeout-ms. Supply a new decision with explicit conflict_id, expected_version and resolution; do not supply an existing original request, key, stdin or repeated options',
    { trace_id: trace, retryable: false, decision_dispatch_state: 'not-sent' },
  );
}

function argumentsFor(argv: string[], trace: string) {
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      tokens: true,
      options: {
        'json-file': { type: 'string' },
        output: { type: 'string' },
        'timeout-ms': { type: 'string' },
      },
    });
    const seen = new Set<string>();
    for (const token of parsed.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw new TypeError();
      seen.add(token.name);
    }
    const file = parsed.values['json-file'];
    const output = parsed.values.output;
    const timeout = parsed.values['timeout-ms'] ?? '30000';
    if (
      parsed.positionals.length !== 2 ||
      parsed.positionals.join(' ') !== 'conflicts prepare' ||
      !file?.trim() ||
      file === '-' ||
      !output?.trim() ||
      output === '-' ||
      !/^[1-9][0-9]{0,9}$/.test(timeout) ||
      Number(timeout) > 2147483647
    )
      throw new TypeError();
    return { file, output, timeout_ms: Number(timeout) };
  } catch {
    throw invalid(trace);
  }
}

async function prepare(
  argv: string[],
  trace: string,
  readIdentity: (timeout: number) => Promise<ConflictCommandContextEnvelope>,
) {
  const args = argumentsFor(argv, trace);
  let output;
  try {
    // Resolve and reject existing destinations before contacting the identity endpoint.
    output = await prepareArtifactOutput(args.output, trace);
  } catch {
    throw new ContractError(
      'CONFLICT_OUTPUT_UNAVAILABLE',
      'Choose a new original-request file in an existing directory; existing files and links are never replaced',
      { trace_id: trace, retryable: false, decision_dispatch_state: 'not-sent' },
    );
  }
  const value = await readConflictJsonFile(args.file, trace);
  let command: Record<string, unknown>;
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    command = JSON.parse(conflictReceiptJson(value)) as Record<string, unknown>;
    // A saved original belongs to submit/receipt. Preparing it again must never mint a new key.
    if (
      ['identity', 'request_key', 'command', 'idempotency_key'].some((key) =>
        Object.hasOwn(command, key),
      )
    )
      throw new TypeError();
  } catch {
    throw invalid(trace);
  }
  let caller: ConflictCommandContextEnvelope;
  try {
    caller = await readIdentity(args.timeout_ms);
  } catch (error) {
    throw new ContractError(
      error instanceof ContractError ? error.envelope.code : 'GATEWAY_UNAVAILABLE',
      error instanceof ContractError
        ? error.envelope.message
        : 'Could not read the conflict preparation identity',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(error instanceof ContractError ? error.envelope.details : {}),
          decision_dispatch_state: 'not-sent',
        },
      },
    );
  }
  const assertCurrentIdentity = () => {
    const expiry = Date.parse(caller.data.expires_at);
    if (!Number.isFinite(expiry) || expiry <= Date.now())
      throw new ContractError(
        'DENIED',
        'The conflict identity expired before preparing the local request; renew access',
        {
          trace_id: trace,
          retryable: false,
          decision_dispatch_state: 'not-sent',
        },
      );
  };
  assertCurrentIdentity();
  let original;
  try {
    original = parseConflictReceiptQuery({
      identity: caller.data.identity,
      request_key: 'workctx-conflict-' + createUlid(),
      command,
    });
  } catch {
    throw invalid(trace);
  }
  // Canonical text preserves every effective command field and fits the original-request limit.
  const raw = conflictReceiptJson(original);
  const content = new TextEncoder().encode(raw);
  assertCurrentIdentity();
  let saved;
  try {
    saved = await saveArtifactOutput(
      output,
      content,
      createHash('sha256').update(content).digest('hex'),
      trace,
    );
  } catch (error) {
    throw new ContractError(
      'CONFLICT_PREPARATION_SAVE_FAILED',
      'The new original request could not be saved completely; no decision was sent. Inspect any reported local paths before preparing again',
      {
        trace_id: trace,
        retryable: false,
        details: {
          ...(error instanceof ContractError
            ? error.envelope.details
            : { output_path: output.path }),
          decision_dispatch_state: 'not-sent',
        },
      },
    );
  }
  try {
    const stored = await readConflictOriginalFile(saved.path, original.identity, trace);
    if (conflictReceiptJson(stored) !== raw) throw new TypeError();
  } catch {
    throw new ContractError(
      'CONFLICT_PREPARATION_READBACK_FAILED',
      'The output was created but its final contents could not be confirmed; keep it for inspection. No decision was sent and the file was not replaced or removed',
      {
        trace_id: trace,
        retryable: false,
        details: {
          local_state: 'published-unconfirmed',
          output_path: saved.path,
          cleanup_pending: saved.cleanup_pending,
          ...(saved.temporary_path === undefined ? {} : { temporary_path: saved.temporary_path }),
          decision_dispatch_state: 'not-sent',
        },
      },
    );
  }
  return {
    schema_version: 1 as const,
    trace_id: trace,
    source_refs: [],
    scope: {
      tenant_id: original.identity.tenant_id,
      workspace_id: original.identity.workspace_id,
      project_id: original.identity.project_id,
    },
    data: {
      status: 'prepared' as const,
      original_file: saved.path,
      identity: original.identity,
      request_key: original.request_key,
      conflict_id: original.command.conflict_id,
      expected_version: original.command.expected_version,
      resolution: original.command.resolution,
      local_state: 'saved-and-read-back' as const,
      decision_dispatch_state: 'not-sent' as const,
      next_action: 'review-original-file' as const,
      cleanup_pending: saved.cleanup_pending,
      ...(saved.temporary_path === undefined ? {} : { temporary_path: saved.temporary_path }),
    },
  };
}

export function callConflictPreparation(
  argv: string[],
  options: {
    base: string;
    token: string;
    trace: string;
    scope: { tenant_id: string; workspace_id: string; project_id: string };
  },
) {
  const snapshot = structuredClone(options);
  return prepare(argv, snapshot.trace, (timeout) =>
    callConflictCommandContext(
      ['conflicts', 'identity', '--timeout-ms', String(timeout)],
      snapshot,
    ),
  );
}

export function runConflictPreparation(
  argv: string[],
  router: CommandRouter,
  inputContext: RequestContext,
) {
  const context = structuredClone(inputContext);
  if (context.idempotency_key !== undefined || context.expected_version !== undefined)
    throw invalid(context.trace_id);
  return prepare(argv, context.trace_id, (timeout) =>
    runConflictCommandContext(
      ['conflicts', 'identity', '--timeout-ms', String(timeout)],
      router,
      context,
    ),
  );
}
