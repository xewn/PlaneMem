import { isUlid } from '@planemem/contracts';
import type { CommandRequest } from './router.js';

// These operations explicitly address an existing/parent session in their top-level input.
// This is the requested target of an entry policy decision, not proof of existence or success.
const sessionTargets = new Set([
  'session.read',
  'session.checkpoint',
  'session.checkpoint.read',
  'session.checkpoint.receipt',
  'session.checkpoints.list',
  'session.command.receipt',
  'session.run.start',
  'session.run.finish',
  'session.run.read',
  'session.runs.list',
  'session.tool.call',
  'session.tool.finish',
  'session.tool.read',
  'session.tools.list',
  'session.end',
  'session.handoff',
  'session.handoff.receipt',
  'session.resume',
  'session.resume.receipt',
]);

export function requestedAuditSession(request: CommandRequest): string | undefined {
  const workbenchSession =
    request.operation === 'workbench.query' &&
    (request.input.operation === 'session' || request.input.operation === 'checkpoints');
  if (!sessionTargets.has(request.operation) && !workbenchSession) return undefined;
  // Do not infer targets from resource strings, query filters, nested original requests,
  // parent_session_id or handoff references; those have different meanings and permissions.
  return isUlid(request.input.session_id) ? request.input.session_id : undefined;
}
