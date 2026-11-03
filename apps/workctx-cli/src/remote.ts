import {
  buildEtag,
  ContractError,
  parseArtifactReceiptQuery,
  isSyncIdentifier,
  parseContextItemListQuery,
  parseProposalListQuery,
  parseCheckpointReceiptQuery,
  parseResumeReceiptQuery,
  parseSessionCommandReceiptQuery,
  parseSessionRunQuery,
  parseSessionToolCallQuery,
  parseSessionRunPage,
  parseSessionRunDetail,
  parseSessionToolCallPage,
  parseSessionToolCallDetail,
  parseWorkItemProjectionQuery,
  parseWorkItemProjection,
  parseWorkItemListQuery,
  parseWorkItemProjectionList,
  parseWorkbenchOverview,
  parseProjectSearchQuery,
  parseProjectSearchPage,
  parseLegacyContextStatusQuery,
  parseLegacyContextListQuery,
  parseLegacyContextListPage,
  parseLegacyContextStatus,
  parseLegacyContextMutation,
  parseLegacyContextMutationReceipt,
  validateErrorEnvelope,
} from '@planemem/contracts';
import type { OutboxScope } from '@planemem/context-bridge';
import { usage } from './cli.js';
import { prepareObservedRead, observedReadResult } from './observed.js';
import { prepareHandoffClaim, handoffClaimResult } from './handoff-claim.js';
import { prepareHandoffCreate, handoffCreateResult } from './handoff-create.js';
import { prepareSessionStart, sessionStartResult } from './session-start.js';
import { prepareSessionActivity, sessionActivityResult } from './session-activity.js';
import { prepareSessionState, sessionStateResult } from './session-state.js';
import { callSessionRegistry } from './session-registry.js';
import { callHandoffRegistry } from './handoff-registry.js';
import { callCheckpointRegistry } from './checkpoint-registry.js';
import { callCheckpointRead } from './checkpoint-reads.js';
import { callConflictRead } from './conflict-read.js';
import { callConflictRegistry } from './conflict-registry.js';
import { callConflictReceipt } from './conflict-receipt.js';
import { callProposalCreateReceipt } from './proposal-create-receipt.js';
import { callProposalReviewReceipt } from './proposal-review-receipt.js';
import { callSyncConsumer, isSyncConsumerCommand } from './sync-consumer.js';
import { prepareHandoffRead, handoffReadResult } from './handoff-read.js';
import { prepareArtifactRead, artifactReadResult } from './artifact-read.js';
import { prepareArtifactReceipt, artifactReceiptResult } from './artifact-receipt.js';
import {
  readArtifactUploadQuery,
  readArtifactUploadContent,
  artifactUploadForm,
  artifactUploadResult,
  artifactUploadUnconfirmed,
  type ArtifactUploadArguments,
} from './artifact-upload.js';
import { prepareCheckpoint, checkpointResult } from './checkpoint.js';
import { prepareResume, resumeResult } from './resume.js';
import {
  preparePlaneInboxRead,
  planeInboxReadResult,
  preparePlaneInboxRetry,
  planeInboxRetryResult,
} from './plane-inbox.js';

interface GatewayOptions {
  base: string;
  token: string;
  scope: OutboxScope;
  trace: string;
  key: string | undefined;
}

function segment(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (!isSyncIdentifier(value) || value === '.' || value === '..') usage('Invalid ' + field);
  return encodeURIComponent(value);
}

function route(command: string, input: Record<string, unknown>) {
  switch (command) {
    case 'artifacts receipt':
      return { method: 'POST', path: '/v1/artifacts/receipt' };
    case 'artifacts get':
    case 'artifacts version':
      return {
        method: 'GET',
        path:
          '/v1/artifacts/' +
          segment(input, 'artifact_id') +
          (command === 'artifacts version' ? '/versions/' + input.version : ''),
      };
    case 'plane-events summary':
      return { method: 'GET', path: '/v1/plane/events/summary' };
    case 'plane-events list': {
      const search = new URLSearchParams();
      for (const [field, value] of Object.entries(input)) search.set(field, String(value));
      return { method: 'GET', path: '/v1/plane/events?' + search };
    }
    case 'plane-events get':
      return { method: 'GET', path: '/v1/plane/events/' + segment(input, 'event_id') };
    case 'plane-events diagnose':
      return {
        method: 'GET',
        path: '/v1/plane/events/' + segment(input, 'event_id') + '/diagnosis',
      };
    case 'plane-events retry':
    case 'plane-events retry-receipt':
      return {
        method: 'POST',
        path:
          '/v1/plane/events/' +
          segment(input, 'event_id') +
          '/retry' +
          (command === 'plane-events retry-receipt' ? '/receipt' : ''),
      };
    case 'observed list': {
      const search = new URLSearchParams();
      for (const [field, value] of Object.entries(input)) search.set(field, String(value));
      return { method: 'GET', path: '/v1/plane/work-items?' + search };
    }
    case 'observed project':
      return { method: 'GET', path: '/v1/projects/' + segment(input, 'project_id') + '/state' };
    case 'observed work-item':
    case 'observed context':
      return {
        method: 'GET',
        path:
          '/v1/work-items/' +
          segment(input, 'work_item_id') +
          (command === 'observed context' ? '/context' : '/state'),
      };
    case 'index list': {
      let query;
      try {
        query = parseLegacyContextListQuery(input);
      } catch (error) {
        usage(error instanceof Error ? error.message : 'Invalid index filters');
      }
      const search = new URLSearchParams();
      for (const [field, value] of Object.entries(query)) search.set(field, String(value));
      return { method: 'GET', path: '/v1/context/index?' + search };
    }
    case 'index status': {
      let query;
      try {
        query = parseLegacyContextStatusQuery(input);
      } catch (error) {
        usage(error instanceof Error ? error.message : 'Invalid index ID');
      }
      return { method: 'GET', path: '/v1/context/index/' + segment(query, 'id') };
    }
    case 'index delete':
    case 'index restore': {
      let mutation;
      try {
        const { idempotency_key: _key, ...fields } = input;
        mutation = parseLegacyContextMutation(fields);
      } catch (error) {
        usage(error instanceof Error ? error.message : 'Invalid index mutation');
      }
      return {
        method: 'POST',
        path: '/v1/context/index/' + segment({ ...mutation }, 'id') + '/' + command.split(' ')[1],
      };
    }
    case 'search':
      try {
        parseProjectSearchQuery(input);
      } catch (error) {
        usage(error instanceof Error ? error.message : 'Invalid search query');
      }
      return { method: 'POST', path: '/v1/search' };
    case 'proposals create':
      return { method: 'POST', path: '/v1/proposals' };
    case 'proposals get': {
      if (Object.keys(input).some((key) => key !== 'proposal_id'))
        usage('proposals get accepts only proposal_id');
      return { method: 'GET', path: '/v1/proposals/' + segment(input, 'proposal_id') };
    }
    case 'proposals list': {
      let filters: ReturnType<typeof parseProposalListQuery>;
      try {
        filters = parseProposalListQuery(input);
      } catch (error) {
        usage(error instanceof Error ? error.message : 'Invalid proposal filters');
      }
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        query.set(key, String(value));
      }
      return { method: 'GET', path: '/v1/proposals?' + query };
    }
    case 'proposals confirm':
    case 'proposals reject':
      return {
        method: 'POST',
        path: '/v1/proposals/' + segment(input, 'proposal_id') + '/' + command.split(' ')[1],
      };
    case 'context create':
      return { method: 'POST', path: '/v1/context-items' };
    case 'context read':
    case 'context read-archived': {
      if (Object.keys(input).some((key) => key !== 'item_id'))
        usage(command + ' accepts only item_id');
      return {
        method: 'GET',
        path:
          '/v1/context-items/' +
          segment(input, 'item_id') +
          (command === 'context read-archived' ? '/archived' : ''),
      };
    }
    case 'context update':
      return { method: 'POST', path: '/v1/context-items/' + segment(input, 'item_id') + '/update' };
    case 'context history':
    case 'context version': {
      const detail = command === 'context version';
      const allowed = detail ? ['item_id', 'version'] : ['item_id', 'before_version', 'limit'];
      if (Object.keys(input).some((field) => !allowed.includes(field)))
        usage('Unknown context history field');
      const query = new URLSearchParams();
      for (const field of detail ? ['version'] : ['before_version', 'limit']) {
        const value = input[field];
        if (value === undefined && !detail) continue;
        if (
          typeof value !== 'number' ||
          !Number.isSafeInteger(value) ||
          value < 1 ||
          (field === 'limit' && value > 100)
        )
          usage('Use a positive version/before_version and limit between 1 and 100');
        query.set(field, String(value));
      }
      return {
        method: 'GET',
        path:
          '/v1/context-items/' +
          segment(input, 'item_id') +
          (detail ? '/versions/' + input.version : '/history' + (query.size ? '?' + query : '')),
      };
    }
    case 'context archive':
    case 'context restore':
    case 'context confirm':
      return {
        method: 'POST',
        path: '/v1/context-items/' + segment(input, 'item_id') + '/' + command.split(' ')[1],
      };
    case 'context compile':
      return { method: 'POST', path: '/v1/context-pack/compile' };
    case 'context get': {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(input)) {
        if (!['pack_id', 'format'].includes(key) || typeof value !== 'string' || !value.trim())
          usage('context get accepts string pack_id and format fields');
        query.set(key, value);
      }
      return { method: 'GET', path: '/v1/context-pack?' + query };
    }
    case 'sessions get':
      return { method: 'GET', path: '/v1/sessions/' + segment(input, 'session_id') };
    case 'handoffs get':
      return { method: 'GET', path: '/v1/handoffs/' + segment(input, 'handoff_id') };
    case 'checkpoints get':
      return {
        method: 'GET',
        path:
          '/v1/sessions/' +
          segment(input, 'session_id') +
          '/checkpoints/' +
          segment(input, 'checkpoint_id'),
      };
    case 'checkpoints history': {
      const before =
        input.before_revision === undefined ? '' : '?before_revision=' + input.before_revision;
      return {
        method: 'GET',
        path: '/v1/sessions/' + segment(input, 'session_id') + '/checkpoints' + before,
      };
    }
    case 'sessions start':
      return { method: 'POST', path: '/v1/sessions' };
    case 'sessions start-receipt':
      return { method: 'POST', path: '/v1/sessions/start/receipt' };
    case 'sessions end':
      return { method: 'POST', path: '/v1/sessions/' + segment(input, 'session_id') + '/end' };
    case 'sessions receipt': {
      const { session_id: _session, ...body } = input;
      try {
        parseSessionCommandReceiptQuery(body);
      } catch (error) {
        usage(error instanceof Error ? error.message : 'Invalid session command receipt query');
      }
      return {
        method: 'POST',
        path: '/v1/sessions/' + segment(input, 'session_id') + '/commands/receipt',
      };
    }
    case 'runs start':
      return { method: 'POST', path: '/v1/sessions/' + segment(input, 'session_id') + '/runs' };
    case 'runs get':
      if (Object.keys(input).some((key) => !['session_id', 'run_id'].includes(key)))
        usage('runs get accepts only session_id and run_id');
      return {
        method: 'GET',
        path: '/v1/sessions/' + segment(input, 'session_id') + '/runs/' + segment(input, 'run_id'),
      };
    case 'runs finish':
      if (
        !['completed', 'failed'].includes(input.status as string) ||
        typeof input.expected_run_version !== 'number' ||
        !Number.isSafeInteger(input.expected_run_version) ||
        input.expected_run_version < 1
      )
        usage('Supply completed/failed and a positive expected_run_version');
      return {
        method: 'POST',
        path:
          '/v1/sessions/' +
          segment(input, 'session_id') +
          '/runs/' +
          segment(input, 'run_id') +
          '/finish',
      };
    case 'tool-calls get':
      if (Object.keys(input).some((key) => !['session_id', 'tool_call_id'].includes(key)))
        usage('tool-calls get accepts only session_id and tool_call_id');
      return {
        method: 'GET',
        path:
          '/v1/sessions/' +
          segment(input, 'session_id') +
          '/tool-calls/' +
          segment(input, 'tool_call_id'),
      };
    case 'tool-calls finish':
      if (
        !['succeeded', 'failed'].includes(input.status as string) ||
        typeof input.expected_tool_version !== 'number' ||
        !Number.isSafeInteger(input.expected_tool_version) ||
        input.expected_tool_version < 1
      )
        usage('Supply succeeded/failed and a positive expected_tool_version');
      return {
        method: 'POST',
        path:
          '/v1/sessions/' +
          segment(input, 'session_id') +
          '/tool-calls/' +
          segment(input, 'tool_call_id') +
          '/finish',
      };
    case 'runs list':
    case 'tool-calls list': {
      const { session_id: _session, ...filters } = input;
      let query;
      try {
        query =
          command === 'runs list'
            ? parseSessionRunQuery(filters)
            : parseSessionToolCallQuery(filters);
      } catch (error) {
        usage(error instanceof Error ? error.message : 'Invalid activity query');
      }
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) search.set(key, String(value));
      return {
        method: 'GET',
        path:
          '/v1/sessions/' +
          segment(input, 'session_id') +
          (command === 'runs list' ? '/runs?' : '/tool-calls?') +
          search,
      };
    }
    case 'tool-calls record':
      return {
        method: 'POST',
        path: '/v1/sessions/' + segment(input, 'session_id') + '/tool-calls',
      };
    case 'handoff receipt':
      return {
        method: 'POST',
        path: '/v1/sessions/' + segment(input, 'session_id') + '/handoff/receipt',
      };
    case 'handoff claim':
      return { method: 'POST', path: '/v1/handoffs/' + segment(input, 'handoff_id') + '/claim' };
    case 'handoff claim-receipt':
      return {
        method: 'POST',
        path: '/v1/handoffs/' + segment(input, 'handoff_id') + '/claim/receipt',
      };
    case 'work-items get':
      try {
        parseWorkItemProjectionQuery(input);
      } catch (error) {
        usage(error instanceof Error ? error.message : 'Invalid work item query');
      }
      return { method: 'POST', path: '/v1/workbench/query' };
    case 'work-items list':
    case 'overview':
    case 'sessions list':
    case 'context list':
    case 'handoffs list':
    case 'checkpoints list':
      return { method: 'POST', path: '/v1/workbench/query' };
    case 'conflicts resolve':
      return {
        method: 'POST',
        path: '/v1/conflicts/' + segment(input, 'conflict_id') + '/resolve',
      };
    case 'checkpoint receipt': {
      const { session_id: _session, ...body } = input;
      try {
        parseCheckpointReceiptQuery(body);
      } catch (error) {
        usage(error instanceof Error ? error.message : 'Invalid receipt query');
      }
      return {
        method: 'POST',
        path: '/v1/sessions/' + segment(input, 'session_id') + '/checkpoint/receipt',
      };
    }
    case 'resume receipt': {
      const { session_id: _session, ...body } = input;
      try {
        parseResumeReceiptQuery(body);
      } catch (error) {
        usage(error instanceof Error ? error.message : 'Invalid resume receipt query');
      }
      return {
        method: 'POST',
        path: '/v1/sessions/' + segment(input, 'session_id') + '/resume/receipt',
      };
    }
    case 'checkpoint':
    case 'resume':
    case 'handoff':
      return {
        method: 'POST',
        path: '/v1/sessions/' + segment(input, 'session_id') + '/' + command,
      };
    default:
      return usage('Unknown remote command');
  }
}

async function request(url: URL, init: RequestInit, trace: string, timeout = 30_000) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new ContractError('GATEWAY_UNAVAILABLE', 'Could not reach the configured gateway', {
      trace_id: trace,
      retryable: true,
    });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ContractError('GATEWAY_RESPONSE_INVALID', 'Gateway returned invalid JSON', {
      trace_id: trace,
      status: response.status,
    });
  }
  return { response, body };
}

function gatewayError(response: Response, body: unknown, trace: string): never {
  let envelope;
  try {
    envelope = validateErrorEnvelope(body);
  } catch {
    throw new ContractError('GATEWAY_HTTP_ERROR', 'Gateway returned HTTP ' + response.status, {
      trace_id: response.headers.get('x-trace-id') ?? trace,
      retryable: response.status === 429 || response.status >= 500,
    });
  }
  throw new ContractError(envelope.code, envelope.message, envelope);
}

export async function callArtifactUpload(
  rawArgs: ArtifactUploadArguments,
  rawOptions: GatewayOptions,
) {
  const args = { ...rawArgs };
  const options = { ...rawOptions, scope: { ...rawOptions.scope } };
  if (options.key !== undefined)
    usage('Artifact uploads use the saved command.request_key, without --key');
  if (!options.token.trim()) usage('A bearer token is required for artifact uploads');
  let base: URL;
  try {
    base = new URL(options.base);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw new TypeError();
  } catch {
    return usage('WORKCTX_URL must be an HTTP(S) URL without credentials, query or fragment');
  }
  const query = await readArtifactUploadQuery(args, options.scope, options.trace);
  const bytes = await readArtifactUploadContent(args, query, options.trace);
  const path =
    query.command.operation === 'artifact.create'
      ? '/v1/artifacts'
      : '/v1/artifacts/' + encodeURIComponent(query.command.artifact_id) + '/versions';
  const headers: Record<string, string> = {
    authorization: 'Bearer ' + options.token,
    'x-tenant-id': options.scope.tenant_id,
    'x-workspace-id': options.scope.workspace_id,
    'x-project-id': options.scope.project_id,
    'x-trace-id': options.trace,
    'x-expected-actor-id': query.identity.actor_id,
    'x-expected-client-id': query.identity.client_id,
    'idempotency-key': query.command.request_key,
    accept: 'application/json',
  };
  if (query.command.operation === 'artifact.put-version')
    headers['if-match'] = buildEtag(query.command.expected_version);
  const form = artifactUploadForm(query, bytes);
  try {
    const { response, body } = await request(
      new URL(path, base),
      {
        method: 'POST',
        headers,
        body: form,
      },
      options.trace,
      args.timeout_ms,
    );
    if (!response.ok) gatewayError(response, body, options.trace);
    return artifactUploadResult(body, query, options.trace);
  } catch (error) {
    throw artifactUploadUnconfirmed(error, options.trace);
  }
}

export async function callGateway(
  command: string,
  input: Record<string, unknown>,
  options: GatewayOptions,
) {
  if (isSyncConsumerCommand(command)) return callSyncConsumer(command, input, options);
  if (command === 'sessions list') return callSessionRegistry(input, options);
  if (command === 'conflicts get') return callConflictRead(input, options);
  if (command === 'conflicts receipt') return callConflictReceipt(input, options);
  if (command === 'proposals receipt') return callProposalCreateReceipt(input, options);
  if (command === 'proposals review-receipt') return callProposalReviewReceipt(input, options);
  if (command === 'conflicts') return callConflictRegistry(input, options);
  if (command === 'handoffs list') return callHandoffRegistry(input, options);
  if (command === 'checkpoints list' && options.key !== undefined)
    usage('Checkpoint directory and history reads do not accept --key');
  if (command === 'checkpoints list' && input.session_id === undefined)
    return callCheckpointRegistry(input, options);
  if (
    command === 'checkpoints get' ||
    command === 'checkpoints history' ||
    command === 'checkpoints list'
  )
    return callCheckpointRead(command, input, options);
  const artifactRead = prepareArtifactRead(command, input, options.trace, options.key);
  const artifactScope = { ...options.scope };
  const artifactTrace = options.trace;
  const artifactReceipt =
    command === 'artifacts receipt'
      ? prepareArtifactReceipt(input, artifactScope, artifactTrace, options.key)
      : undefined;
  if (artifactReceipt) input = { ...parseArtifactReceiptQuery(artifactReceipt) };
  if (artifactRead) input = { ...artifactRead };
  const handoffClaim = prepareHandoffClaim(
    command,
    input,
    options.scope,
    options.trace,
    options.key,
  );
  if (handoffClaim) input = handoffClaim.input;
  const handoffCreate = prepareHandoffCreate(
    command,
    input,
    options.scope,
    options.trace,
    options.key,
  );
  if (handoffCreate) input = handoffCreate.input;
  const sessionStart = prepareSessionStart(
    command,
    input,
    options.scope,
    options.trace,
    options.key,
  );
  if (sessionStart) input = sessionStart.input;
  const sessionActivity = prepareSessionActivity(
    command,
    input,
    options.scope,
    options.trace,
    options.key,
  );
  if (sessionActivity) input = sessionActivity.input;
  const checkpoint = prepareCheckpoint(command, input, options.scope, options.trace, options.key);
  if (checkpoint) input = checkpoint.input;
  const resume = prepareResume(command, input, options.scope, options.trace, options.key);
  if (resume) input = resume.input;
  const planeRetry = preparePlaneInboxRetry(
    command,
    input,
    options.scope,
    options.trace,
    options.key,
  );
  if (planeRetry) input = { ...planeRetry.input };
  const planeInbox = preparePlaneInboxRead(command, input, options.trace);
  if (planeInbox) {
    if (options.key !== undefined) usage('Event queue reads do not accept --key');
    input = planeInbox.input;
  }
  const observed = prepareObservedRead(command, input, options.scope.project_id, options.trace);
  if (observed) {
    if (options.key !== undefined) usage('Observed reads do not accept --key');
    input = observed.input;
  }
  const sessionState = prepareSessionState(command, input, options.trace, options.key);
  if (sessionState) input = sessionState;
  const handoffRead = prepareHandoffRead(command, input, options.trace, options.key);
  if (handoffRead) input = handoffRead;
  const { method, path } = route(command, input);
  const listing = path === '/v1/workbench/query';
  if (listing) {
    const allowed =
      command === 'checkpoints list'
        ? ['session_id', 'before_revision']
        : command === 'context list'
          ? [
              'query',
              'layer',
              'classification',
              'status',
              'item_type',
              'cursor',
              'limit',
              'archived',
            ]
          : command === 'work-items get'
            ? ['item_id']
            : command === 'work-items list'
              ? ['query', 'status', 'priority', 'owner', 'cursor', 'limit']
              : [];
    if (Object.keys(input).some((field) => !allowed.includes(field)))
      usage(command + ' accepts ' + (allowed.join(', ') || 'no JSON fields'));
    if (command === 'context list') {
      try {
        input = { ...parseContextItemListQuery(input) };
      } catch (error) {
        usage(error instanceof Error ? error.message : 'Invalid context query');
      }
    }
    if (command === 'work-items list') {
      try {
        input = { ...parseWorkItemListQuery(input) };
      } catch (error) {
        usage(error instanceof Error ? error.message : 'Invalid work item query');
      }
    }
    if (input.session_id !== undefined) segment(input, 'session_id');
    if (
      input.before_revision !== undefined &&
      (input.session_id === undefined ||
        typeof input.before_revision !== 'number' ||
        !Number.isSafeInteger(input.before_revision) ||
        input.before_revision < 1)
    )
      usage('before_revision requires session_id and must be a positive integer');
  }
  const headers: Record<string, string> = {
    authorization: 'Bearer ' + options.token,
    'x-tenant-id': options.scope.tenant_id,
    'x-workspace-id': options.scope.workspace_id,
    'x-project-id': options.scope.project_id,
    'x-trace-id': options.trace,
  };
  if (
    method === 'POST' &&
    command !== 'checkpoint receipt' &&
    command !== 'resume receipt' &&
    command !== 'sessions receipt' &&
    !handoffClaim &&
    !handoffCreate &&
    !sessionStart &&
    !artifactReceipt &&
    !sessionActivity &&
    !checkpoint &&
    !resume &&
    command !== 'search' &&
    !planeRetry &&
    !listing &&
    !options.key
  )
    usage('Supply --key for this command and reuse it when retrying');
  if (options.key && !listing) headers['idempotency-key'] = options.key;
  if (artifactReceipt) {
    headers['x-expected-actor-id'] = artifactReceipt.identity.actor_id;
    headers['x-expected-client-id'] = artifactReceipt.identity.client_id;
  }
  if (resume) {
    headers['x-expected-actor-id'] = resume.binding.identity.actor_id;
    headers['x-expected-client-id'] = resume.binding.identity.client_id;
    if (!resume.lookup) headers['idempotency-key'] = resume.binding.query.request_key;
  }
  if (checkpoint) {
    headers['x-expected-actor-id'] = checkpoint.binding.identity.actor_id;
    headers['x-expected-client-id'] = checkpoint.binding.identity.client_id;
    if (!checkpoint.lookup) headers['idempotency-key'] = checkpoint.binding.query.request_key;
  }
  if (sessionActivity) {
    headers['x-expected-actor-id'] = sessionActivity.binding.identity.actor_id;
    headers['x-expected-client-id'] = sessionActivity.binding.identity.client_id;
    if (!sessionActivity.lookup)
      headers['idempotency-key'] = sessionActivity.binding.query.request_key;
  }
  if (sessionStart) {
    headers['x-expected-actor-id'] = sessionStart.binding.identity.actor_id;
    headers['x-expected-client-id'] = sessionStart.binding.identity.client_id;
    if (!sessionStart.lookup) headers['idempotency-key'] = sessionStart.binding.query.request_key;
  }
  if (handoffCreate) {
    headers['x-expected-actor-id'] = handoffCreate.binding.identity.actor_id;
    headers['x-expected-client-id'] = handoffCreate.binding.identity.client_id;
    if (!handoffCreate.lookup) headers['idempotency-key'] = handoffCreate.binding.query.request_key;
  }
  if (handoffClaim) {
    headers['x-expected-actor-id'] = handoffClaim.binding.identity.actor_id;
    headers['x-expected-client-id'] = handoffClaim.binding.identity.client_id;
    if (!handoffClaim.lookup) headers['idempotency-key'] = handoffClaim.binding.query.request_key;
  }
  if (planeRetry) {
    headers['x-expected-actor-id'] = planeRetry.identity.actor_id;
    headers['x-expected-client-id'] = planeRetry.identity.client_id;
    if (!planeRetry.lookup) headers['idempotency-key'] = planeRetry.input.request_key;
  }
  if (command === 'proposals confirm' || command === 'proposals reject') {
    if (
      typeof input.expected_revision !== 'number' ||
      !Number.isSafeInteger(input.expected_revision) ||
      input.expected_revision < 1 ||
      input.expected_version !== undefined
    )
      usage('Supply expected_revision from the proposal');
    headers['if-match'] = buildEtag(input.expected_revision);
  }
  if (
    [
      'checkpoint',
      'sessions end',
      'runs start',
      'runs finish',
      'tool-calls record',
      'tool-calls finish',
      'conflicts resolve',
      'handoff claim',
      'context update',
      'context archive',
      'context restore',
      'context confirm',
    ].includes(command) &&
    input.expected_version === undefined
  )
    usage('Supply expected_version from the current session, handoff, conflict or context item');
  if (input.expected_version !== undefined) {
    if (
      typeof input.expected_version !== 'number' ||
      !Number.isSafeInteger(input.expected_version) ||
      input.expected_version < 1
    )
      usage('expected_version must be a positive integer');
    headers['if-match'] = buildEtag(input.expected_version);
  }
  const init: RequestInit = { method, headers };
  if (method === 'POST') {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(
      listing
        ? {
            ...input,
            operation:
              command === 'work-items get'
                ? 'work_item'
                : command === 'work-items list'
                  ? 'work_items'
                  : command.split(' ')[0],
          }
        : input,
    );
  }
  const { response, body } = await request(new URL(path, options.base), init, options.trace);
  if (!response.ok) gatewayError(response, body, options.trace);
  if (
    !body ||
    typeof body !== 'object' ||
    !('schema_version' in body) ||
    body.schema_version !== 1 ||
    !('trace_id' in body) ||
    typeof body.trace_id !== 'string' ||
    !('source_refs' in body) ||
    !Array.isArray(body.source_refs) ||
    !('data' in body)
  )
    throw new ContractError('GATEWAY_RESPONSE_INVALID', 'Expected a WCP response envelope', {
      trace_id: options.trace,
    });
  if (observed) return observedReadResult(body, observed, options.scope, options.trace);
  if (artifactRead) return artifactReadResult(body, artifactRead, artifactScope, artifactTrace);
  if (artifactReceipt) return artifactReceiptResult(body, artifactReceipt, artifactTrace);
  if (handoffClaim) return handoffClaimResult(body, handoffClaim, options.trace);
  if (handoffCreate) return handoffCreateResult(body, handoffCreate, options.trace);
  if (handoffRead) return handoffReadResult(body, handoffRead, options.scope, options.trace);
  if (sessionStart) return sessionStartResult(body, sessionStart, options.trace);
  if (sessionActivity) return sessionActivityResult(body, sessionActivity, options.trace);
  if (checkpoint) return checkpointResult(body, checkpoint, options.trace);
  if (resume) return resumeResult(body, resume, options.trace);
  if (planeInbox) return planeInboxReadResult(body, planeInbox, options.scope, options.trace);
  if (planeRetry) return planeInboxRetryResult(body, planeRetry, options.trace);
  if (command === 'search') {
    try {
      const data = parseProjectSearchPage(body.data, parseProjectSearchQuery(input));
      if (
        data.scope.tenant_id !== options.scope.tenant_id ||
        data.scope.workspace_id !== options.scope.workspace_id ||
        data.scope.project_id !== options.scope.project_id
      )
        throw new Error('Search scope mismatch');
      return { ...body, data };
    } catch {
      throw new ContractError('GATEWAY_RESPONSE_INVALID', 'Expected a project search page', {
        trace_id: options.trace,
      });
    }
  }
  if (command === 'index status' || command === 'index delete' || command === 'index restore') {
    try {
      const { idempotency_key: _key, ...fields } = input;
      const data =
        command === 'index status'
          ? parseLegacyContextStatus(body.data, String(input.id))
          : parseLegacyContextMutationReceipt(
              body.data,
              parseLegacyContextMutation(fields),
              command === 'index delete' ? 'delete' : 'restore',
              options.key!,
            );
      const record = 'record' in data ? data.record : data;
      if (
        record.tenant_id !== options.scope.tenant_id ||
        record.workspace_id !== options.scope.workspace_id ||
        record.project_id !== options.scope.project_id
      )
        throw new Error('Index scope mismatch');
      return { ...body, data };
    } catch {
      throw new ContractError(
        'GATEWAY_RESPONSE_INVALID',
        'Expected matching index metadata or a historical command receipt',
        {
          trace_id: options.trace,
        },
      );
    }
  }
  if (command === 'index list') {
    try {
      const data = parseLegacyContextListPage(body.data, parseLegacyContextListQuery(input));
      if (
        data.scope.tenant_id !== options.scope.tenant_id ||
        data.scope.workspace_id !== options.scope.workspace_id ||
        data.scope.project_id !== options.scope.project_id
      )
        throw new Error();
      return { ...body, data };
    } catch {
      throw new ContractError('GATEWAY_RESPONSE_INVALID', 'Expected a scoped index page', {
        trace_id: options.trace,
      });
    }
  }
  if (command === 'overview') {
    try {
      return { ...body, data: parseWorkbenchOverview(body.data) };
    } catch {
      throw new ContractError(
        'GATEWAY_RESPONSE_INVALID',
        'Expected a project overview with consistent totals and previews',
        { trace_id: options.trace },
      );
    }
  }
  if (command === 'work-items list') {
    try {
      return { ...body, ...parseWorkItemProjectionList(body, parseWorkItemListQuery(input)) };
    } catch {
      throw new ContractError('GATEWAY_RESPONSE_INVALID', 'Expected a work item projection page', {
        trace_id: options.trace,
      });
    }
  }
  if (command === 'work-items get') {
    try {
      return { ...body, data: parseWorkItemProjection(body.data, String(input.item_id)) };
    } catch {
      throw new ContractError(
        'GATEWAY_RESPONSE_INVALID',
        'Expected the requested work item projection',
        { trace_id: options.trace },
      );
    }
  }
  if (sessionState) return sessionStateResult(body, sessionState, options.scope, options.trace);
  if (command === 'tool-calls get') {
    try {
      return {
        ...body,
        data: parseSessionToolCallDetail(
          body.data,
          String(input.session_id),
          String(input.tool_call_id),
        ),
      };
    } catch {
      throw new ContractError(
        'GATEWAY_RESPONSE_INVALID',
        'Expected the requested tool call detail',
        {
          trace_id: options.trace,
        },
      );
    }
  }
  if (command === 'runs get') {
    try {
      return {
        ...body,
        data: parseSessionRunDetail(body.data, String(input.session_id), String(input.run_id)),
      };
    } catch {
      throw new ContractError('GATEWAY_RESPONSE_INVALID', 'Expected the requested run detail', {
        trace_id: options.trace,
      });
    }
  }
  if (command === 'runs list' || command === 'tool-calls list') {
    const { session_id, ...query } = input;
    try {
      return {
        ...body,
        data:
          command === 'runs list'
            ? parseSessionRunPage(body.data, String(session_id), parseSessionRunQuery(query))
            : parseSessionToolCallPage(
                body.data,
                String(session_id),
                parseSessionToolCallQuery(query),
              ),
      };
    } catch {
      throw new ContractError(
        'GATEWAY_RESPONSE_INVALID',
        'Expected a matching session activity page',
        { trace_id: options.trace },
      );
    }
  }
  return body;
}

export async function readReadiness(base: string, trace: string) {
  const path = '/health/ready';
  const { response, body } = await request(
    new URL(path, base),
    { headers: { 'x-trace-id': trace } },
    trace,
  );
  if (!response.ok && response.status !== 503) gatewayError(response, body, trace);
  if (
    !body ||
    typeof body !== 'object' ||
    !('ready' in body) ||
    typeof body.ready !== 'boolean' ||
    body.ready !== response.ok
  )
    throw new ContractError('GATEWAY_RESPONSE_INVALID', 'Expected a gateway readiness report', {
      trace_id: trace,
    });
  return {
    schema_version: 1,
    data: { ...body, ready: body.ready },
    trace_id: trace,
    source_refs: [{ type: 'gateway', id: path }],
  };
}
