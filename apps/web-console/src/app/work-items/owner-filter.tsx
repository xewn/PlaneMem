'use client';

import { useState } from 'react';
import type { WorkItemListQuery } from '@planemem/contracts';

export function WorkItemOwnerFilter({
  initialAssignment,
  initialOwner,
}: {
  initialAssignment: NonNullable<WorkItemListQuery['assignment']> | '';
  initialOwner: string;
}) {
  const [assignment, setAssignment] = useState(initialAssignment);
  const [owner, setOwner] = useState(initialOwner);
  return (
    <>
      <select
        className="filter-chip"
        name="assignment"
        aria-label="Saved owner assignment"
        aria-describedby="work-item-owner-hint"
        value={assignment}
        onChange={(event) => {
          const value = event.currentTarget.value;
          if (value !== '' && value !== 'assigned' && value !== 'unassigned') return;
          setAssignment(value);
          if (value === 'unassigned') setOwner('');
        }}
      >
        <option value="">All assignments</option>
        <option value="assigned">With saved owner</option>
        <option value="unassigned">Without saved owner</option>
      </select>
      <label className="filter-input">
        <input
          type="text"
          name="owner"
          value={owner}
          onChange={(event) => setOwner(event.currentTarget.value)}
          disabled={assignment === 'unassigned'}
          aria-label="Exact owner, case-sensitive"
          placeholder="Exact owner"
          maxLength={255}
          aria-describedby="work-item-owner-hint"
        />
      </label>
      <p
        className="muted"
        id="work-item-owner-hint"
        style={{ flexBasis: '100%', order: 1, margin: 0 }}
      >
        {assignment === 'unassigned'
          ? 'Shows items whose saved owner is empty. Exact owner filtering is turned off.'
          : 'Owner matches saved text exactly, including case and spaces. Leave it blank to use only the assignment filter.'}
      </p>
    </>
  );
}
