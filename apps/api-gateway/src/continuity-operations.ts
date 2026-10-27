import { createHash, randomUUID } from 'node:crypto';
import { ContractError } from '@planemem/contracts';
import type { CommandRequest, CommandResult, RequestContext } from './router.js';

export const continuityProtocol = 'p02-continuity-v1';
export const continuityActions = [
  'session.start',
  'session.run',
  'session.tool-call',
  'session.checkpoint',
  'session.end',
] as const;
export interface ContinuityConfiguration {
  endpoint_ref: string;
  configuration_digest: string;
}
export interface ContinuityRequest extends ContinuityConfiguration {
  protocol_version: string;
  operation_key: string;
  specification_digest: string;
  dispatch_attempt: number;
  action: string;
  expected_revision?: number;
  payload: Record<string, unknown>;
}
export interface OperationProof {
  protocol_version: typeof continuityProtocol;
  operation_key: string;
  specification_digest: string;
  scope: { tenant_id: string; workspace_id: string; project_id: string };
  action: string;
  actor_id: string;
  client_id: string;
  endpoint_ref: string;
  configuration_digest: string;
  dispatch_attempt: number;
  outcome: 'ConfirmedEffect' | 'ConfirmedNoEffect';
  receipt_ref: string;
  revision: number | null;
  result: CommandResult | null;
  source_refs: Array<{ type: string; id: string }>;
  observed_at: string;
}
export interface OperationRecord {
  operation_key: string;
  dispatch_attempt: number;
  fingerprint: string;
  proof: OperationProof;
}
export interface OperationTransaction {
  execute(command: CommandRequest): Promise<CommandResult>;
  find(operationKey: string): Promise<OperationRecord[]>;
  insert(record: OperationRecord): Promise<void>;
}
/** run commits effect and receipt atomically; a failed/uncertain commit is never converted to NoEffect. */
export interface OperationTransactions {
  isReady(): Promise<boolean>;
  run<T>(work: (transaction: OperationTransaction) => Promise<T>): Promise<T>;
}

export async function continuityCapabilityReport(
  configuration: ContinuityConfiguration,
  transactions?: OperationTransactions,
) {
  let ready = false;
  if (
    configuration.endpoint_ref &&
    /^[a-f0-9]{64}$/.test(configuration.configuration_digest) &&
    transactions
  ) {
    try {
      ready = await transactions.isReady();
    } catch {
      ready = false;
    }
  }
  return {
    protocol_version: continuityProtocol,
    ...configuration,
    durable_operation_proof: ready,
    actions: ready ? [...continuityActions] : [],
    observed_at: new Date().toISOString(),
  };
}

export class ContinuityOperations {
  constructor(
    private readonly transactions: OperationTransactions,
    private readonly configuration: ContinuityConfiguration,
  ) {}

  execute(request: ContinuityRequest, context: RequestContext): Promise<OperationProof> {
    return this.change(request, context, false);
  }
  close(request: ContinuityRequest, context: RequestContext): Promise<OperationProof> {
    return this.change(request, context, true);
  }
  async query(request: ContinuityRequest, context: RequestContext): Promise<OperationProof | null> {
    const fingerprint = this.validate(request, context);
    return this.transactions.run(async (transaction) => {
      const records = await transaction.find(request.operation_key);
      this.match(records, fingerprint, context);
      return records.find((r) => r.dispatch_attempt === request.dispatch_attempt)?.proof ?? null;
    });
  }
  private async change(
    request: ContinuityRequest,
    context: RequestContext,
    close: boolean,
  ): Promise<OperationProof> {
    const fingerprint = this.validate(request, context);
    return this.transactions.run(async (transaction) => {
      const records = await transaction.find(request.operation_key);
      this.match(records, fingerprint, context);
      const original = records.find((r) => r.dispatch_attempt === request.dispatch_attempt);
      if (original) return original.proof;
      const previous = records.at(-1);
      if (
        request.dispatch_attempt !== (previous?.dispatch_attempt ?? 0) + 1 ||
        (previous && previous.proof.outcome !== 'ConfirmedNoEffect')
      )
        throw failure(
          'OPERATION_ATTEMPT_CONFLICT',
          'Attempt must follow a closed NoEffect attempt',
          context,
        );
      const result = close ? null : await transaction.execute(toCommand(request, context));
      const data = result?.data as { version?: number; revision?: number } | undefined;
      const revision = !result
        ? null
        : request.action === 'session.run' || request.action === 'session.tool-call'
          ? request.expected_revision! + 1
          : request.action === 'session.checkpoint'
            ? data!.revision!
            : data!.version!;
      if (result && (!Number.isSafeInteger(revision) || revision! < 1))
        throw failure(
          'OPERATION_RESULT_INVALID',
          'Result revision must be a positive safe integer',
          context,
        );
      const proof: OperationProof = {
        protocol_version: continuityProtocol,
        operation_key: request.operation_key,
        specification_digest: request.specification_digest,
        scope: {
          tenant_id: context.tenant_id,
          workspace_id: context.workspace_id,
          project_id: context.project_id,
        },
        action: request.action,
        actor_id: context.actor_id,
        client_id: context.client_id,
        endpoint_ref: request.endpoint_ref,
        configuration_digest: request.configuration_digest,
        dispatch_attempt: request.dispatch_attempt,
        outcome: close ? 'ConfirmedNoEffect' : 'ConfirmedEffect',
        receipt_ref: `planemem-operation:${randomUUID()}`,
        revision,
        result,
        source_refs: result?.source_refs ?? [],
        observed_at: new Date().toISOString(),
      };
      await transaction.insert({
        operation_key: request.operation_key,
        dispatch_attempt: request.dispatch_attempt,
        fingerprint,
        proof,
      });
      const stored = (await transaction.find(request.operation_key)).find(
        (record) => record.dispatch_attempt === request.dispatch_attempt,
      );
      if (!stored || stored.fingerprint !== fingerprint)
        throw failure(
          'OPERATION_RESULT_INVALID',
          'Original receipt was not readable inside the transaction',
          context,
        );
      return stored.proof;
    });
  }
  private match(records: OperationRecord[], fingerprint: string, context: RequestContext): void {
    if (records.some((record) => record.fingerprint !== fingerprint))
      throw failure(
        'IDEMPOTENCY_KEY_REUSED',
        'Operation key belongs to another immutable request',
        context,
      );
  }
  private validate(request: ContinuityRequest, context: RequestContext): string {
    if (
      !request ||
      request.protocol_version !== continuityProtocol ||
      request.endpoint_ref !== this.configuration.endpoint_ref ||
      request.configuration_digest !== this.configuration.configuration_digest
    )
      throw failure(
        'OPERATION_CONFIGURATION_CONFLICT',
        'Protocol or configured endpoint does not match',
        context,
      );
    if (!continuityActions.includes(request.action as never))
      throw failure(
        'OPERATION_UNSUPPORTED',
        'Action has no durable operation implementation',
        context,
      );
    if (
      typeof request.operation_key !== 'string' ||
      !request.operation_key.trim() ||
      request.operation_key.length > 256 ||
      !/^[a-f0-9]{64}$/.test(request.specification_digest) ||
      !Number.isSafeInteger(request.dispatch_attempt) ||
      request.dispatch_attempt < 1
    )
      throw failure('INVALID_INPUT', 'Invalid operation identity or dispatch attempt', context);
    if (
      request.action === 'session.start'
        ? request.expected_revision !== undefined
        : !Number.isSafeInteger(request.expected_revision) ||
          request.expected_revision! < 1 ||
          request.expected_revision! >= Number.MAX_SAFE_INTEGER
    )
      throw failure('INVALID_INPUT', 'Invalid expected revision', context);
    if (
      !request.payload ||
      Array.isArray(request.payload) ||
      typeof request.payload !== 'object' ||
      Buffer.byteLength(JSON.stringify(request)) > 128 * 1024
    )
      throw failure('INVALID_INPUT', 'Invalid or oversized operation payload', context);
    const allowed: Record<string, string[]> = {
      'session.start': ['parent_session_id'],
      'session.run': ['session_id', 'model'],
      'session.tool-call': ['session_id', 'run_id', 'tool_name', 'status'],
      'session.checkpoint': [
        'session_id',
        'completed',
        'in_progress',
        'next_actions',
        'decisions',
        'risks',
        'open_questions',
      ],
      'session.end': ['session_id', 'status', 'approval_ref'],
    };
    if (Object.keys(request.payload).some((key) => !allowed[request.action]!.includes(key)))
      throw failure(
        'INVALID_INPUT',
        'Payload contains fields outside the action contract',
        context,
      );
    return createHash('sha256')
      .update(
        JSON.stringify(
          stable({
            protocol_version: request.protocol_version,
            operation_key: request.operation_key,
            specification_digest: request.specification_digest,
            endpoint_ref: request.endpoint_ref,
            configuration_digest: request.configuration_digest,
            action: request.action,
            expected_revision: request.expected_revision ?? null,
            payload: request.payload,
            scope: [context.tenant_id, context.workspace_id, context.project_id],
            actor_id: context.actor_id,
            client_id: context.client_id,
          }),
        ),
      )
      .digest('hex');
  }
}
function toCommand(request: ContinuityRequest, context: RequestContext): CommandRequest {
  const operations: Record<string, string> = {
    'session.run': 'session.run.start',
    'session.tool-call': 'session.tool.call',
  };
  return {
    operation: operations[request.action] ?? request.action,
    input: request.payload,
    context: {
      ...context,
      idempotency_key: `continuity:${request.operation_key}`,
      ...(request.expected_revision === undefined
        ? {}
        : { expected_version: request.expected_revision }),
    },
  };
}
function failure(code: string, message: string, context: RequestContext): ContractError {
  return new ContractError(code, message, { trace_id: context.trace_id, retryable: false });
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, stable(item)]),
    );
  return value;
}
