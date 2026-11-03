import {
  ContractError,
  parseCheckpointHistoryQuery,
  parseCheckpointHistoryEnvelope,
  parseCheckpointHistoryWorkbenchEnvelope,
} from '@planemem/contracts';
import type { HttpRequest } from '../http.js';

export function checkpointHistoryToolResult(value: unknown, request: HttpRequest) {
  try {
    if (
      request.method === 'POST' &&
      request.path === '/v1/workbench/query' &&
      request.body?.operation === 'checkpoints'
    ) {
      const { operation, ...fields } = request.body;
      return parseCheckpointHistoryWorkbenchEnvelope(
        value,
        parseCheckpointHistoryQuery(fields),
        request.context,
        request.context.trace_id,
      );
    }
    const query = parseCheckpointHistoryQuery(request.body);
    if (
      request.method !== 'GET' ||
      request.path !== '/v1/sessions/' + encodeURIComponent(query.session_id) + '/checkpoints'
    )
      throw new TypeError();
    return parseCheckpointHistoryEnvelope(value, query, request.context, request.context.trace_id);
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Expected the requested checkpoint history page',
      { trace_id: request.context.trace_id },
    );
  }
}
