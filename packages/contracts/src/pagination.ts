export interface PageRequest {
  limit: number;
  cursor?: string;
}

export interface PageResponse<T> {
  items: T[];
  has_more: boolean;
  next_cursor?: string;
  total?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizePageRequest(input: unknown): PageRequest {
  if (input === undefined || input === null) {
    return { limit: 50 };
  }
  if (!isRecord(input)) {
    throw new TypeError('Page request must be an object');
  }
  const limitValue = input.limit === undefined ? 50 : input.limit;
  if (
    typeof limitValue !== 'number' ||
    !Number.isSafeInteger(limitValue) ||
    limitValue < 1 ||
    limitValue > 100
  ) {
    throw new RangeError('Page limit must be an integer between 1 and 100');
  }
  if (
    input.cursor !== undefined &&
    (typeof input.cursor !== 'string' || input.cursor.length === 0)
  ) {
    throw new TypeError('Page cursor must be a non-empty string');
  }
  return {
    limit: limitValue,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  };
}

export function validatePageResponse<T>(input: unknown): PageResponse<T> {
  if (!isRecord(input) || !Array.isArray(input.items) || typeof input.has_more !== 'boolean') {
    throw new TypeError('Invalid page response');
  }
  if (input.has_more && (typeof input.next_cursor !== 'string' || input.next_cursor.length === 0)) {
    throw new TypeError('next_cursor is required when has_more is true');
  }
  if (!input.has_more && input.next_cursor !== undefined) {
    throw new TypeError('next_cursor must be omitted when has_more is false');
  }
  if (
    input.total !== undefined &&
    (!Number.isSafeInteger(input.total) || (input.total as number) < 0)
  ) {
    throw new TypeError('total must be a non-negative integer');
  }
  return input as unknown as PageResponse<T>;
}
