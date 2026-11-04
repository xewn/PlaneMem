'use client';

import { useState } from 'react';
import type { WorkItemListQuery } from '@planemem/contracts';

export function WorkItemDueFilter({
  initialDue,
  initialFrom,
  initialBefore,
}: {
  initialDue: NonNullable<WorkItemListQuery['due']> | '';
  initialFrom: string;
  initialBefore: string;
}) {
  const [due, setDue] = useState(initialDue);
  const [from, setFrom] = useState(initialFrom);
  const [before, setBefore] = useState(initialBefore);
  return (
    <>
      <select
        className="filter-chip"
        name="due"
        aria-label="Saved due date availability"
        aria-describedby="work-item-due-hint"
        value={due}
        onChange={(event) => {
          const value = event.currentTarget.value;
          if (value !== '' && value !== 'scheduled' && value !== 'unscheduled') return;
          setDue(value);
          if (value === 'unscheduled') {
            setFrom('');
            setBefore('');
          }
        }}
      >
        <option value="">All due dates</option>
        <option value="scheduled">With a due date</option>
        <option value="unscheduled">Without a due date</option>
      </select>
      <label className="filter-input work-item-date-filter">
        <span>Due on or after (UTC)</span>
        <input
          type="date"
          name="due_from"
          min="0001-01-01"
          max="9999-12-31"
          value={from}
          onChange={(event) => setFrom(event.currentTarget.value)}
          disabled={due === 'unscheduled'}
          aria-describedby="work-item-due-hint"
        />
      </label>
      <label className="filter-input work-item-date-filter">
        <span>Due before (UTC)</span>
        <input
          type="date"
          name="due_before"
          min="0001-01-01"
          max="9999-12-31"
          value={before}
          onChange={(event) => setBefore(event.currentTarget.value)}
          disabled={due === 'unscheduled'}
          aria-describedby="work-item-due-hint"
        />
      </label>
      <p
        className="muted"
        id="work-item-due-hint"
        style={{ flexBasis: '100%', order: 1, margin: 0 }}
      >
        Dates use midnight UTC. The start date is included; the end date is excluded. Leave either
        boundary empty for an open range. Date ranges exclude items without a saved due date and do
        not change the selected status.
      </p>
    </>
  );
}
