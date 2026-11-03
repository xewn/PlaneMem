import { open } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ContractError, parseCreateProposal, validateIdempotencyKey } from '@planemem/contracts';
import { flushProposalQueue } from './publisher.js';
import { SqliteProposalQueue, type ProposalQueueBinding } from './submission.js';
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

const help = `Proposal submission queue (Node.js 24)
  proposal-worker prepare-generation --binding binding.json --file selection.json --output NEW_SOURCES.json [--record]
  proposal-worker generate --provider provider.json --file sources.json --output NEW_DRAFT.json
  proposal-worker generate-prepared --provider provider.json --file PREPARATION_RECORD.json --output NEW_GENERATION_RECORD.json
  proposal-worker inspect-generation --file RECORD.json
  proposal-worker enqueue-generated --queue queue.sqlite --binding binding.json --file GENERATION_RECORD.json --key KEY
  proposal-worker enqueue --queue queue.sqlite --binding binding.json --file draft.json --key KEY
  proposal-worker list    --queue queue.sqlite --binding binding.json [--before JOB_ID] [--limit 25]
  proposal-worker get     --queue queue.sqlite --binding binding.json --id JOB_ID
  proposal-worker retry   --queue queue.sqlite --binding binding.json --id JOB_ID
  proposal-worker flush   --queue queue.sqlite --binding binding.json [--limit 25]

binding.json contains gateway_url, tenant_id, workspace_id, project_id, actor_id, client_id.
list/get open an existing initialized queue read-only; missing files are never created.
generate calls the configured model once using PROPOSAL_GENERATION_API_KEY; it saves a new draft, without opening a queue.
generate-prepared uses the same single call and saves the complete record; it does not refresh sources.
inspect-generation verifies record consistency offline; enqueue-generated requires the original destination binding.
prepare-generation reads pinned sources from the gateway; flush submits drafts. Both use PROPOSAL_WORKER_ACCESS_TOKEN.
retry schedules the original draft/key; it does not send or regenerate content.
Exit codes: 0 completed, 1 command/storage failure, 2 flush had retry/blocked/lost-lease jobs.
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
      },
    });
    const command = positionals[0];
    const allowed: Record<string, string[]> = {
      'prepare-generation': ['binding', 'file', 'output', 'record'],
      generate: ['provider', 'file', 'output'],
      'generate-prepared': ['provider', 'file', 'output'],
      'inspect-generation': ['file'],
      'enqueue-generated': ['file', 'key'],
      enqueue: ['file', 'key'],
      list: ['before', 'limit'],
      get: ['id'],
      retry: ['id'],
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
    const limit = values.limit === undefined ? 25 : Number(values.limit);
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
    const id = command === 'get' || command === 'retry' ? required('id') : undefined;
    if (command === 'flush' && !process.env.PROPOSAL_WORKER_ACCESS_TOKEN?.trim())
      throw new ContractError(
        'UNAUTHENTICATED',
        'Set PROPOSAL_WORKER_ACCESS_TOKEN before flushing',
      );
    queue = new SqliteProposalQueue(path, binding, {
      readonly: command === 'list' || command === 'get',
    });
    let output: unknown;
    let exitCode = 0;
    switch (command) {
      case 'enqueue':
        output = queue.enqueue(draft!, key!);
        break;
      case 'enqueue-generated':
        output = { job: queue.enqueue(draft!, key!), record_sha256: generatedRecord!.sha256 };
        break;
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
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    return exitCode;
  } catch (error) {
    // Never echo database contents, draft text, raw provider responses or credentials.
    const code =
      error instanceof ContractError
        ? error.envelope.code
        : error instanceof TypeError || error instanceof SyntaxError
          ? 'INVALID_INPUT'
          : 'PROPOSAL_QUEUE_COMMAND_FAILED';
    const sourceDetails: Record<string, unknown> = {};
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
