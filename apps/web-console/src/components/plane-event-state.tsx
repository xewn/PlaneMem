import type { PlaneInboxRecord, PlaneInboxStatus } from '@planemem/contracts';
import { Badge } from './ui';

export function PlaneEventStatus({ status }: { status: PlaneInboxStatus }) {
  return (
    <Badge tone={status === 'applied' ? 'green' : status === 'rejected' ? 'red' : 'yellow'}>
      {status === 'applied' ? 'Processed' : status === 'rejected' ? 'Rejected' : 'Pending'}
    </Badge>
  );
}

export function planeEventExplanation(item: PlaneInboxRecord): string {
  if (item.status === 'applied' && item.event_type === 'WorkItemRestored')
    return 'The restoration observation was processed with new fields and its local index was reactivated. This is a historical result; read the current state to check availability. External copies were not restored by this event.';
  if (item.status === 'applied' && item.event_type === 'WorkItemDeleted')
    return 'The deletion observation was processed and its local search index was deactivated. This does not confirm removal of external copies or local work item records.';
  if (item.status === 'applied')
    return 'Historical processing is complete. This does not confirm the current availability or freshness of the observation.';
  if (!item.last_error_code) return 'The event has been saved and is waiting for processing.';
  const reasons: Record<string, string> = {
    AGGREGATE_VERSION_GAP:
      'The last attempt reported a missing earlier version. It may have arrived since then; missing events are not fetched automatically.',
    AGGREGATE_VERSION_OUT_OF_ORDER:
      'This version is older than, or conflicts with, an already processed version.',
    PLANE_PROCESSING_RETRY:
      'A processing transaction could not complete. The saved event is scheduled for another attempt.',
    PLANE_EVENT_ID_CONFLICT: 'This event ID conflicts with another saved observation.',
    PLANE_EXTERNAL_ID_CHANGED:
      'The external ID changed for this record. Automatic remapping is not available.',
    PLANE_EXTERNAL_ID_CONFLICT:
      'An external or aggregate ID conflicts with an existing observation.',
    PLANE_STREAM_CONFLICT: 'Multiple historical events claim the same latest version.',
    PLANE_PROJECTION_CONFLICT: 'The saved snapshot has a conflicting version.',
    PLANE_PROJECTION_MISMATCH:
      'The event, generated snapshot and index do not describe the same record.',
    PLANE_INDEX_CONFLICT: 'The index is deleted, expired or has a conflicting revision.',
    PLANE_RECORD_DELETED:
      'The saved work item observation was deleted. Restoring it requires a new restoration observation that references the latest deletion.',
    PLANE_RESTORE_PRECONDITION_FAILED:
      'The restoration does not match the latest deletion, or its deletion snapshot and unexpired index are unavailable or inconsistent. Repeating this event does not repair the saved records.',
    PLANE_INBOX_INVALID: 'The saved event receipt is inconsistent and needs investigation.',
  };
  return (
    reasons[item.last_error_code] ??
    'Review the saved error code and processing audit for more information.'
  );
}
