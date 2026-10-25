import { ContractError } from '@planemem/contracts';
import { CommandRouter, type CommandResult, type RequestContext } from '@planemem/api-gateway';

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
  const command = argv[0];
  const operation =
    command === 'resume'
      ? 'session.resume'
      : command === 'checkpoint'
        ? 'session.checkpoint'
        : command === 'handoff'
          ? 'session.handoff'
          : command === 'sync'
            ? 'sync.reconcile'
            : command === 'conflicts'
              ? 'conflict.list'
              : command === 'doctor'
                ? 'system.doctor'
                : undefined;
  if (!operation)
    return {
      exit_code: 2,
      stdout: '',
      stderr: JSON.stringify({
        code: 'USAGE_ERROR',
        message: 'Expected resume, checkpoint, handoff, sync, conflicts or doctor',
        trace_id: context.trace_id,
      }),
    };
  try {
    const input = parseJsonArgument(argv.slice(1));
    const result = await router.execute({ operation, input, context });
    return { exit_code: 0, stdout: JSON.stringify(result), stderr: '' };
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
    return { exit_code: 1, stdout: '', stderr: JSON.stringify(envelope) };
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
  try {
    const parsed: unknown = JSON.parse(value);
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
