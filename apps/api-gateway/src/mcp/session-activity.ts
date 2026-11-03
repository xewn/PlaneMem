import {
  ContractError,
  buildEtag,
  parseSessionCommandBinding,
  parseSessionActivityCreateCommand,
  parseSessionActivityCreateEnvelope,
  parseSessionCommandReceiptEnvelope,
  parseSessionFinishCommand,
  parseSessionFinishEnvelope,
  type SessionCommandBinding,
  type SessionCommandOperation,
} from '@planemem/contracts';
import type { HttpRequest } from '../http.js';
import type { RequestContext } from '../router.js';

export function isSessionActivityTool(name: string): boolean {
  return [
    'start_agent_run',
    'record_tool_call',
    'finish_agent_run',
    'finish_tool_call',
    'end_session',
    'get_session_command_receipt',
  ].includes(name);
}
function operationForTool(name: string): SessionCommandOperation {
  return name === 'start_agent_run'
    ? 'run.start'
    : name === 'record_tool_call'
      ? 'tool.call'
      : name === 'finish_agent_run'
        ? 'run.finish'
        : name === 'finish_tool_call'
          ? 'tool.finish'
          : 'end';
}
function sessionCommandPath(binding: SessionCommandBinding, lookup: boolean): string {
  const root = `/v1/sessions/${encodeURIComponent(binding.session_id)}/`;
  if (lookup) return root + 'commands/receipt';
  switch (binding.query.operation) {
    case 'run.start':
      return root + 'runs';
    case 'tool.call':
      return root + 'tool-calls';
    case 'run.finish':
      return root + 'runs/' + encodeURIComponent(String(binding.query.command.run_id)) + '/finish';
    case 'tool.finish':
      return (
        root +
        'tool-calls/' +
        encodeURIComponent(String(binding.query.command.tool_call_id)) +
        '/finish'
      );
    case 'end':
      return root + 'end';
  }
}
export function prepareSessionActivityTool(
  name: string,
  input: Record<string, unknown>,
  context: RequestContext,
): HttpRequest {
  const fail = (message: string): never => {
    throw new ContractError('INVALID_INPUT', message, { trace_id: context.trace_id });
  };
  if (!isSessionActivityTool(name)) fail('Unknown session activity tool');
  if (context.authenticated_client !== true)
    throw new ContractError(
      'DENIED',
      'A verified client is required for activity commands and receipts',
      { trace_id: context.trace_id },
    );
  const lookup = name === 'get_session_command_receipt';
  const { expected_identity, ...fields } = input;
  if (lookup && fields.idempotency_key !== undefined)
    fail('Receipt queries use request_key without new write options');
  const { session_id, ...query } = fields;
  const operation = operationForTool(name);
  let binding;
  try {
    binding = parseSessionCommandBinding(
      session_id,
      lookup
        ? query
        : {
            operation,
            request_key: fields.idempotency_key,
            command:
              operation === 'run.start' || operation === 'tool.call'
                ? parseSessionActivityCreateCommand(operation, fields)
                : parseSessionFinishCommand(operation, fields),
          },
      expected_identity,
      context,
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Invalid original activity command');
  }
  if (
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
    ((context.idempotency_key !== undefined &&
      context.idempotency_key !== binding.query.request_key) ||
      (context.expected_version !== undefined &&
        context.expected_version !== binding.query.command.expected_version))
  )
    fail('Original activity key or version differs from the request context');
  const clean = { ...context };
  delete clean.idempotency_key;
  delete clean.expected_version;
  if (!lookup) {
    clean.idempotency_key = binding.query.request_key;
    clean.expected_version = binding.query.command.expected_version;
  }
  return {
    method: 'POST',
    path: sessionCommandPath(binding, lookup),
    body: lookup
      ? { session_id: binding.session_id, ...binding.query }
      : { ...binding.query.command },
    context: clean,
    headers: {
      'content-type': 'application/json',
      ...(lookup
        ? {}
        : {
            'idempotency-key': binding.query.request_key,
            'if-match': buildEtag(binding.query.command.expected_version),
          }),
    },
  };
}
export function sessionActivityToolResult(name: string, value: unknown, request: HttpRequest) {
  try {
    if (
      !isSessionActivityTool(name) ||
      request.method !== 'POST' ||
      !request.body ||
      typeof request.body !== 'object' ||
      Array.isArray(request.body)
    )
      throw new TypeError();
    const context = request.context;
    const fields = request.body as Record<string, unknown>;
    const lookup = name === 'get_session_command_receipt';
    const { session_id, ...query } = fields;
    const operation = operationForTool(name);
    const binding = parseSessionCommandBinding(
      session_id,
      lookup
        ? query
        : {
            operation,
            request_key: context.idempotency_key,
            command: fields,
          },
      {
        tenant_id: context.tenant_id,
        workspace_id: context.workspace_id,
        project_id: context.project_id,
        actor_id: context.actor_id,
        client_id: context.client_id,
      },
      context,
    );
    if (request.path !== sessionCommandPath(binding, lookup)) throw new TypeError();
    return lookup
      ? parseSessionCommandReceiptEnvelope(value, binding, context.trace_id)
      : operation === 'run.start' || operation === 'tool.call'
        ? parseSessionActivityCreateEnvelope(value, binding, context.trace_id)
        : parseSessionFinishEnvelope(value, binding, context.trace_id);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'The activity response could not be confirmed. Keep the original identity, parameters, version and key, then query its receipt.',
      { trace_id: request.context.trace_id, retryable: true },
    );
  }
}
