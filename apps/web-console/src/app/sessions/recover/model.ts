import {
  isUlid,
  parseSessionCommandIdentity,
  type SessionCommandIdentity,
} from '@planemem/contracts';
import {
  START_RECOVERY_LIMIT,
  startRecoveryStorageKey,
  decodeStartRecovery,
  encodeStartRecovery,
  type StartRequest,
  type StartFeedback,
} from '../start-model';
import {
  ACTIVITY_CREATE_RECOVERY_LIMIT,
  activityCreateRecoveryStorageKey,
  decodeActivityCreateRecovery,
  encodeActivityCreateRecovery,
  type ActivityCreateOperation,
  type ActivityCreateRequest,
  type ActivityCreateFeedback,
} from '../../../lib/activity-create';
import {
  CHECKPOINT_RECOVERY_LIMIT,
  checkpointRecoveryStorageKey,
  decodeCheckpointRecovery,
  encodeCheckpointRecovery,
  type CheckpointSaveRequest,
  type CheckpointSaveFeedback,
} from '../checkpoint-model';
import {
  FINISH_RECOVERY_LIMIT,
  finishRecoveryStorageKey,
  decodeFinishRecovery,
  encodeFinishRecovery,
  type FinishOperation,
  type FinishRequest,
  type FinishFeedback,
} from '../activity/finish-model';

export type RecoveryOperation =
  | 'session.start'
  | 'checkpoint.save'
  | FinishOperation
  | ActivityCreateOperation;
export const recoveryLabels: Record<RecoveryOperation, string> = {
  'session.start': 'Start session',
  'checkpoint.save': 'Save checkpoint',
  end: 'Close session',
  'run.start': 'Start run record',
  'run.finish': 'Record run result',
  'tool.call': 'Record tool call',
  'tool.finish': 'Record tool call result',
};
export type OriginalSessionRequest =
  | { operation: 'session.start'; request: StartRequest }
  | { operation: ActivityCreateOperation; request: ActivityCreateRequest }
  | { operation: 'checkpoint.save'; request: CheckpointSaveRequest }
  | { operation: FinishOperation; request: FinishRequest };
export type OriginalSessionFeedback =
  | { kind: 'start'; value: Exclude<StartFeedback, { status: 'idle' }> }
  | { kind: 'activity'; value: Exclude<ActivityCreateFeedback, { status: 'idle' }> }
  | { kind: 'checkpoint'; value: Exclude<CheckpointSaveFeedback, { status: 'idle' }> }
  | { kind: 'finish'; value: Exclude<FinishFeedback, { status: 'idle' }> };

export function recoveryLimit(operation: RecoveryOperation): number {
  if (operation === 'session.start') return START_RECOVERY_LIMIT;
  if (operation === 'run.start' || operation === 'tool.call') return ACTIVITY_CREATE_RECOVERY_LIMIT;
  return operation === 'checkpoint.save' ? CHECKPOINT_RECOVERY_LIMIT : FINISH_RECOVERY_LIMIT;
}
export function recoveryStorageKey(
  identity: SessionCommandIdentity,
  operation: RecoveryOperation,
  sessionId: string | undefined,
  resourceId: string | undefined,
): string {
  if (operation === 'session.start') return startRecoveryStorageKey(identity);
  if (!isUlid(sessionId)) throw new TypeError('Select the original session.');
  if (operation === 'checkpoint.save') return checkpointRecoveryStorageKey(identity, sessionId);
  if (operation === 'run.start')
    return activityCreateRecoveryStorageKey(identity, sessionId, operation);
  if (operation === 'end')
    return finishRecoveryStorageKey(identity, operation, sessionId, sessionId);
  if (!isUlid(resourceId)) throw new TypeError('Select the original run or tool call.');
  if (operation === 'tool.call')
    return activityCreateRecoveryStorageKey(identity, sessionId, operation, resourceId);
  return finishRecoveryStorageKey(identity, operation, sessionId, resourceId);
}
export function originalSessionId(original: OriginalSessionRequest): string | undefined {
  return original.operation === 'session.start' ? undefined : original.request.sessionId;
}
export function originalResourceId(original: OriginalSessionRequest): string | undefined {
  if (original.operation === 'session.start') return undefined;
  if (original.operation === 'run.start' || original.operation === 'tool.call')
    return original.request.operation === 'tool.call' ? original.request.runId : undefined;
  if (original.operation === 'checkpoint.save') return original.request.sessionId;
  return original.request.operation === 'end'
    ? original.request.sessionId
    : original.request.resourceId;
}
export function decodeOriginalSessionRequest(
  raw: string,
  operation: RecoveryOperation,
  identity: SessionCommandIdentity,
): OriginalSessionRequest {
  let original: OriginalSessionRequest;
  if (operation === 'checkpoint.save') {
    original = { operation, request: decodeCheckpointRecovery(raw) };
  } else if (operation === 'session.start') {
    original = { operation, request: decodeStartRecovery(raw) };
  } else if (operation === 'run.start' || operation === 'tool.call') {
    const request = decodeActivityCreateRecovery(raw);
    if (request.operation !== operation)
      throw new TypeError('The recovery text belongs to another operation.');
    original = { operation, request };
  } else {
    const request = decodeFinishRecovery(raw);
    if (request.operation !== operation)
      throw new TypeError('The recovery text belongs to another operation.');
    original = { operation, request };
  }
  if (
    JSON.stringify(original.request.identity) !==
    JSON.stringify(parseSessionCommandIdentity(identity))
  )
    throw new TypeError('Use the original account, client and project to recover this request.');
  return original;
}
export function encodeOriginalSessionRequest(original: OriginalSessionRequest): string {
  if (original.operation === 'session.start') return encodeStartRecovery(original.request);
  if (original.operation === 'checkpoint.save') return encodeCheckpointRecovery(original.request);
  if (original.operation !== original.request.operation)
    throw new TypeError('The recovery operation does not match its original request.');
  if (original.operation === 'run.start' || original.operation === 'tool.call')
    return encodeActivityCreateRecovery(original.request);
  return encodeFinishRecovery(original.request);
}
export function unknownOriginalFeedback(
  original: OriginalSessionRequest,
  message: string,
): OriginalSessionFeedback {
  if (original.operation === 'session.start')
    return {
      kind: 'start',
      value: { status: 'error', request: original.request, uncertain: true, message },
    };
  if (original.operation === 'run.start' || original.operation === 'tool.call')
    return {
      kind: 'activity',
      value: { status: 'error', request: original.request, uncertain: true, message },
    };
  return original.operation === 'checkpoint.save'
    ? {
        kind: 'checkpoint',
        value: { status: 'error', request: original.request, uncertain: true, message },
      }
    : {
        kind: 'finish',
        value: { status: 'error', request: original.request, uncertain: true, message },
      };
}
