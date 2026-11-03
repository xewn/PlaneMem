import {
  parseLegacyContextIdentity,
  parseLegacyContextMutation,
  validateIdempotencyKey,
  type LegacyContextIdentity,
  type LegacyContextAction,
  type LegacyContextMutation,
  type LegacyContextMutationReceipt,
} from '@planemem/contracts';

export interface IndexRequest {
  key: string;
  operation: LegacyContextAction;
  input: LegacyContextMutation;
  identity: LegacyContextIdentity;
}
export type IndexFeedback =
  | { status: 'idle' }
  | {
      status: 'done';
      request: IndexRequest;
      receipt: LegacyContextMutationReceipt;
      message: string;
      trace?: string;
    }
  | {
      status: 'error';
      request?: IndexRequest;
      uncertain: boolean;
      message: string;
      trace?: string;
    };

export function parseIndexRequest(value: unknown): IndexRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid index request');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !['key', 'operation', 'input', 'identity'].includes(key)) ||
    (input.operation !== 'delete' && input.operation !== 'restore')
  )
    throw new TypeError('Invalid index operation');
  return {
    key: validateIdempotencyKey(input.key),
    operation: input.operation,
    input: parseLegacyContextMutation(input.input),
    identity: parseLegacyContextIdentity(input.identity),
  };
}
export function sameIndexRequest(left: IndexRequest, right: IndexRequest) {
  return JSON.stringify(parseIndexRequest(left)) === JSON.stringify(parseIndexRequest(right));
}
