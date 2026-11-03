import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ContractError } from '@planemem/contracts';
import type { ProposalQueueBinding } from './queue-binding.js';
import {
  inspectGenerationRequest,
  inspectGenerationAttempt,
  inspectGenerationOutcome,
  validateGenerationRequestKey,
  GENERATION_REQUEST_BYTES,
  type ProposalGenerationRequestRecord,
  type ProposalGenerationRequestState,
} from './generation-request.js';

// Internal shared read path; this module never writes or dispatches a request.
export interface JournalReadBudget {
  remaining: number;
}
export class JournalReadBudgetExceeded extends Error {}

export function failure(code: string, message: string, request?: ProposalGenerationRequestRecord) {
  return new ContractError(
    code,
    message,
    request
      ? {
          request_id: request.request_id,
          request_key: request.request_key,
          request_sha256: request.sha256,
          trace_id: 'trace_generation_request_' + request.request_id,
        }
      : {},
  );
}
export async function directory(value: string) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f]/.test(value))
    throw new TypeError('Use an existing journal directory');
  const root = await realpath(value);
  if (!(await stat(root)).isDirectory()) throw new TypeError('Use an existing journal directory');
  return root;
}
export function paths(root: string, key: string) {
  validateGenerationRequestKey(key);
  const name = 'generation-' + createHash('sha256').update(key, 'utf8').digest('hex');
  return {
    request: join(root, name + '.request.json'),
    attempt: join(root, name + '.attempt.json'),
    outcome: join(root, name + '.outcome.json'),
  };
}
export async function readOptional(
  path: string,
  maximum: number,
  budget?: JournalReadBudget,
): Promise<unknown | undefined> {
  let before: Stats;
  try {
    before = await lstat(path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return undefined;
    throw error;
  }
  if (!before.isFile() || before.size < 1 || before.size > maximum)
    throw new TypeError('Invalid journal file');
  if (budget) {
    if (before.size + 1 > budget.remaining) throw new JournalReadBudgetExceeded();
    budget.remaining -= before.size + 1;
  }
  const file = await open(path, 'r');
  try {
    const identity = await file.stat();
    if (
      !identity.isFile() ||
      identity.ino !== before.ino ||
      identity.dev !== before.dev ||
      identity.size !== before.size ||
      identity.size > maximum
    )
      throw new TypeError();
    const buffer = Buffer.alloc(identity.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await lstat(path);
    if (
      length > maximum ||
      !after.isFile() ||
      after.ino !== identity.ino ||
      after.dev !== identity.dev ||
      after.size !== length ||
      identity.size !== length
    )
      throw new TypeError();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
  } finally {
    await file.close();
  }
}
export async function readState(
  root: string,
  binding: ProposalQueueBinding,
  key: string,
  budget?: JournalReadBudget,
  initialRequest?: unknown,
): Promise<ProposalGenerationRequestState> {
  const files = paths(root, key);
  let request: ProposalGenerationRequestRecord | undefined;
  try {
    const input =
      initialRequest === undefined
        ? await readOptional(files.request, GENERATION_REQUEST_BYTES, budget)
        : initialRequest;
    if (input === undefined)
      throw failure(
        'PROPOSAL_GENERATION_REQUEST_NOT_FOUND',
        'No saved generation request has this key',
      );
    request = inspectGenerationRequest(input, binding, key);
    let attempted = await readOptional(files.attempt, 8192, budget);
    const completed = await readOptional(files.outcome, GENERATION_REQUEST_BYTES, budget);
    // Immutable publication order is request -> attempt -> outcome. A concurrent completion may
    // appear between reads; re-read its prerequisite instead of reporting false corruption.
    if (completed !== undefined && attempted === undefined)
      attempted = await readOptional(files.attempt, 8192, budget);
    const attempt = attempted === undefined ? null : inspectGenerationAttempt(attempted, request);
    if (completed !== undefined && !attempt) throw new TypeError();
    const outcome =
      completed === undefined ? null : inspectGenerationOutcome(completed, request, attempt!);
    return {
      request,
      attempt,
      outcome,
      state: outcome
        ? outcome.record
          ? 'generated'
          : 'failed'
        : attempt
          ? 'attempted'
          : 'prepared',
    };
  } catch (error) {
    if (error instanceof JournalReadBudgetExceeded) throw error;
    if (
      error instanceof ContractError &&
      ['PROPOSAL_GENERATION_REQUEST_NOT_FOUND', 'PROPOSAL_GENERATION_BINDING_MISMATCH'].includes(
        error.envelope.code,
      )
    )
      throw error;
    throw failure(
      'PROPOSAL_GENERATION_REQUEST_INVALID',
      'The complete original journal files could not be verified; do not replace an attempt marker',
      request,
    );
  }
}
