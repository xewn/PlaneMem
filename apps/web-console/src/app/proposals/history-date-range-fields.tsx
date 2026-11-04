'use client';

import { useId } from 'react';
import { historyDateRangeError, type HistoryDateRange } from './history-date-range';

export function HistoryDateRangeFields({
  from,
  through,
  onChange,
}: {
  from: string;
  through: string;
  onChange: (name: keyof HistoryDateRange, value: string) => void;
}) {
  const id = useId();
  const error = historyDateRangeError(from, through);
  const description = `${id}-help${error ? ` ${id}-error` : ''}`;
  return (
    <div role="group" aria-label="Observation date range" style={{ display: 'grid', gap: 6 }}>
      <label htmlFor={`${id}-from`}>Observation date from (UTC, optional)</label>
      <input
        id={`${id}-from`}
        type="text"
        placeholder="YYYY-MM-DD"
        maxLength={10}
        autoComplete="off"
        spellCheck={false}
        value={from}
        aria-describedby={description}
        aria-invalid={!!error}
        onChange={(event) => onChange('observed_from', event.target.value)}
      />
      <label htmlFor={`${id}-through`}>Observation date through (UTC, optional)</label>
      <input
        id={`${id}-through`}
        type="text"
        placeholder="YYYY-MM-DD"
        maxLength={10}
        autoComplete="off"
        spellCheck={false}
        value={through}
        aria-describedby={description}
        aria-invalid={!!error}
        onChange={(event) => onChange('observed_through', event.target.value)}
      />
      <p id={`${id}-help`}>
        Enter dates as YYYY-MM-DD. Both dates are included. Dates use UTC and the time this result
        was observed, not the proposal's event time. Leave either date empty for no limit on that
        side.
      </p>
      {error && (
        <p id={`${id}-error`} role="status">
          {error}
        </p>
      )}
    </div>
  );
}
