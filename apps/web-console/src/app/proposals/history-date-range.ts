export interface HistoryDateRange {
  observed_from: string | null;
  observed_through: string | null;
}

function date(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01')
    throw new TypeError('Use complete valid UTC dates (YYYY-MM-DD).');
  const midnight = `${value}T00:00:00.000Z`;
  if (!Number.isFinite(Date.parse(midnight)) || new Date(midnight).toISOString() !== midnight)
    throw new TypeError('Use complete valid UTC dates (YYYY-MM-DD).');
  return value;
}

/** Inclusive calendar dates, without local-time conversion or permissive date normalization. */
export function parseHistoryDateRange(from: unknown, through: unknown): HistoryDateRange {
  const observed_from = date(from);
  const observed_through = date(through);
  if (observed_from !== null && observed_through !== null && observed_from > observed_through)
    throw new TypeError('The first observation date must be on or before the last date.');
  return { observed_from, observed_through };
}

export function historyDateRangeError(from: string, through: string): string | null {
  try {
    parseHistoryDateRange(from || null, through || null);
    return null;
  } catch (error) {
    return error instanceof TypeError ? error.message : 'Check the observation date range.';
  }
}

/** The observation and query have already passed their complete model validation. */
export function matchesHistoryDateRange(observedAt: string, range: HistoryDateRange) {
  const observedDate = observedAt.slice(0, 10);
  return (
    (range.observed_from === null || observedDate >= range.observed_from) &&
    (range.observed_through === null || observedDate <= range.observed_through)
  );
}
