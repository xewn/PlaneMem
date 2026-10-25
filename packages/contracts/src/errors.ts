export type ErrorDetails = Record<string, unknown>;

export interface ErrorEnvelope {
  code: string;
  message: string;
  details: ErrorDetails;
  trace_id: string;
  retryable: boolean;
}

export interface ContractErrorOptions extends ErrorDetails {
  details?: ErrorDetails;
  trace_id?: string;
  retryable?: boolean;
}

export class ContractError extends Error {
  readonly envelope: ErrorEnvelope;

  constructor(code: string, message: string, options: ContractErrorOptions = {}) {
    const { details, trace_id, retryable, ...inlineDetails } = options;
    super(message);
    this.name = 'ContractError';
    this.envelope = validateErrorEnvelope({
      code,
      message,
      details: details ?? inlineDetails,
      trace_id: trace_id ?? 'trace_unknown',
      retryable: retryable ?? false,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateErrorEnvelope(input: unknown): ErrorEnvelope {
  if (!isRecord(input)) {
    throw new TypeError('Error envelope must be an object');
  }
  if (
    typeof input.code !== 'string' ||
    !/^[A-Z][A-Z0-9_]+$/.test(input.code) ||
    typeof input.message !== 'string' ||
    input.message.length === 0 ||
    typeof input.trace_id !== 'string' ||
    input.trace_id.length === 0 ||
    typeof input.retryable !== 'boolean' ||
    !isRecord(input.details)
  ) {
    throw new TypeError('Invalid error envelope');
  }
  return {
    code: input.code,
    message: input.message,
    details: input.details,
    trace_id: input.trace_id,
    retryable: input.retryable,
  };
}

export function serializeError(error: unknown): string {
  if (error instanceof ContractError) {
    return JSON.stringify(error.envelope);
  }
  if (
    isRecord(error) &&
    typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    isRecord(error.details) &&
    typeof error.trace_id === 'string' &&
    typeof error.retryable === 'boolean'
  ) {
    return JSON.stringify(validateErrorEnvelope(error));
  }
  return JSON.stringify(
    validateErrorEnvelope({
      code: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
      details: {},
      trace_id: 'trace_unknown',
      retryable: true,
    }),
  );
}
