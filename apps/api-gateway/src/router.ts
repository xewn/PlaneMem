import { ContractError } from '@planemem/contracts';

export interface RequestContext {
  tenant_id: string;
  workspace_id: string;
  project_id: string;
  actor_id: string;
  client_id: string;
  trace_id: string;
  capability: string[];
  roles?: string[];
  token_expires_at?: string;
  schema_version: 1;
  idempotency_key?: string;
  expected_version?: number;
}

export interface CommandRequest {
  operation: string;
  input: Record<string, unknown>;
  context: RequestContext;
}

export interface CommandResult {
  schema_version: 1;
  trace_id: string;
  source_refs: Array<{ type: string; id: string }>;
  data: unknown;
}

export type CommandHandler = (request: CommandRequest) => Promise<CommandResult> | CommandResult;
export type PolicyDecision = { allowed: true } | { allowed: false; reason: string };
export type PolicyEvaluator = (request: CommandRequest) => PolicyDecision | Promise<PolicyDecision>;
export type DecisionObserver = (
  request: CommandRequest,
  decision: PolicyDecision,
) => void | Promise<void>;

export class CommandRouter {
  private readonly handlers = new Map<string, CommandHandler>();

  constructor(
    private readonly policy: PolicyEvaluator = () => ({ allowed: true }),
    private readonly observeDecision?: DecisionObserver,
  ) {}

  register(operation: string, handler: CommandHandler): void {
    if (this.handlers.has(operation))
      throw new ContractError('COMMAND_ALREADY_REGISTERED', 'Command is already registered', {
        operation,
        trace_id: 'trace_gateway_register',
        retryable: false,
      });
    this.handlers.set(operation, handler);
  }

  async execute(request: CommandRequest): Promise<CommandResult> {
    const decision = await this.policy(request);
    await this.observeDecision?.(request, decision);
    if (!decision.allowed)
      throw new ContractError('DENIED', decision.reason, {
        operation: request.operation,
        trace_id: request.context.trace_id,
        retryable: false,
      });
    const handler = this.handlers.get(request.operation);
    if (!handler)
      throw new ContractError('COMMAND_NOT_FOUND', 'Command is not supported', {
        operation: request.operation,
        trace_id: request.context.trace_id,
        retryable: false,
      });
    const result = await handler(request);
    if (result.trace_id !== request.context.trace_id)
      throw new ContractError(
        'TRACE_MISMATCH',
        'Command result must preserve the inbound trace_id',
        { trace_id: request.context.trace_id, retryable: false },
      );
    return result;
  }
}
