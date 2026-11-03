import { open } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ContractError, parseCreateProposal } from '@planemem/contracts';
import { flushProposalQueue } from './publisher.js';
import { SqliteProposalQueue, type ProposalQueueBinding } from './submission.js';

const help = `Proposal submission queue (Node.js 24)
  proposal-worker enqueue --queue queue.sqlite --binding binding.json --file draft.json --key KEY
  proposal-worker list    --queue queue.sqlite --binding binding.json [--before JOB_ID] [--limit 25]
  proposal-worker get     --queue queue.sqlite --binding binding.json --id JOB_ID
  proposal-worker retry   --queue queue.sqlite --binding binding.json --id JOB_ID
  proposal-worker flush   --queue queue.sqlite --binding binding.json [--limit 25]

binding.json contains gateway_url, tenant_id, workspace_id, project_id, actor_id, client_id.
Only flush contacts the gateway. It reads PROPOSAL_WORKER_ACCESS_TOKEN from the environment.
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
      },
    });
    const command = positionals[0];
    const allowed: Record<string, string[]> = {
      enqueue: ['file', 'key'],
      list: ['before', 'limit'],
      get: ['id'],
      retry: ['id'],
      flush: ['limit'],
    };
    if (!command || !Object.hasOwn(allowed, command) || positionals.length !== 1)
      throw new TypeError('Expected enqueue, list, get, retry or flush');
    for (const option of Object.keys(values))
      if (!['queue', 'binding', ...allowed[command]!].includes(option))
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
    const limit = values.limit === undefined ? 25 : Number(values.limit);
    if (values.limit !== undefined && (!/^[1-9]\d{0,2}$/.test(values.limit) || limit > 100))
      throw new TypeError('--limit must be between 1 and 100');
    // Validate inputs before creating/opening the queue file.
    const path = required('queue');
    const binding = (await readJson(required('binding'), 16_384)) as ProposalQueueBinding;
    const draft =
      command === 'enqueue'
        ? parseCreateProposal(await readJson(required('file'), 1_048_576))
        : undefined;
    const key = command === 'enqueue' ? required('key') : undefined;
    const id = command === 'get' || command === 'retry' ? required('id') : undefined;
    if (command === 'flush' && !process.env.PROPOSAL_WORKER_ACCESS_TOKEN?.trim())
      throw new ContractError(
        'UNAUTHENTICATED',
        'Set PROPOSAL_WORKER_ACCESS_TOKEN before flushing',
      );
    queue = new SqliteProposalQueue(path, binding);
    let output: unknown;
    let exitCode = 0;
    switch (command) {
      case 'enqueue':
        output = queue.enqueue(draft!, key!);
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
    process.stderr.write(
      JSON.stringify({
        code,
        message:
          'Proposal queue command failed. Check arguments, local queue access and gateway configuration; use --help for syntax.',
      }) + '\n',
    );
    return 1;
  } finally {
    queue?.close();
  }
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
