import {
  ContractError,
  parseObservedReadInput,
  parseObservedSnapshot,
  parseObservedWorkItemListQuery,
  parseObservedWorkItemPage,
  parseObservedWorkItemContext,
  validateSourceRef,
  type ObservedReadKind,
  type ObservedScope,
} from '@planemem/contracts';

type PreparedObservedRead =
  | {
      kind: 'list';
      input: ReturnType<typeof parseObservedWorkItemListQuery>;
    }
  | {
      kind: ObservedReadKind;
      id: string;
      input: Record<string, unknown>;
    };

export function prepareObservedRead(
  command: string,
  input: Record<string, unknown>,
  projectId: string,
  traceId: string,
): PreparedObservedRead | undefined {
  if (command === 'observed list') {
    try {
      return { kind: 'list', input: parseObservedWorkItemListQuery(input) };
    } catch (error) {
      throw new ContractError(
        'USAGE_ERROR',
        error instanceof Error ? error.message : 'Invalid observation directory query',
        { trace_id: traceId },
      );
    }
  }
  const kinds: Record<string, ObservedReadKind> = {
    'observed project': 'project',
    'observed work-item': 'work-item',
    'observed context': 'context',
  };
  if (!Object.hasOwn(kinds, command)) return;
  const kind = kinds[command]!;
  try {
    const { id } = parseObservedReadInput(input, kind, projectId);
    return { kind, id, input: kind === 'project' ? { project_id: id } : { work_item_id: id } };
  } catch (error) {
    throw new ContractError(
      'USAGE_ERROR',
      error instanceof Error ? error.message : 'Invalid observed read',
      { trace_id: traceId },
    );
  }
}

export function observedReadResult(
  value: unknown,
  read: PreparedObservedRead,
  scope: ObservedScope,
  traceId: string,
) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const result = value as Record<string, unknown>;
    if (
      result.schema_version !== 1 ||
      result.trace_id !== traceId ||
      !Array.isArray(result.source_refs)
    )
      throw new Error();
    if (read.kind === 'list') {
      if (result.source_refs.length !== 0) throw new Error();
      return {
        ...result,
        schema_version: 1 as const,
        trace_id: traceId,
        source_refs: [],
        data: parseObservedWorkItemPage(result.data, scope, read.input),
      };
    }
    const data =
      read.kind === 'context'
        ? parseObservedWorkItemContext(result.data, read.id, scope, traceId)
        : parseObservedSnapshot(
            result.data,
            read.kind === 'project' ? 'Project' : 'WorkItem',
            read.id,
            scope,
          );
    const expectedRefs = 'work_item' in data ? data.context_pack.source_refs : data.source_refs;
    const source_refs = result.source_refs.map((raw) => {
      const ref = validateSourceRef(raw);
      return {
        type: ref.type,
        id: ref.id,
        ...(ref.revision === undefined ? {} : { revision: ref.revision }),
        ...(ref.uri === undefined ? {} : { uri: ref.uri }),
      };
    });
    if (JSON.stringify(source_refs) !== JSON.stringify(expectedRefs)) throw new Error();
    return { ...result, schema_version: 1 as const, trace_id: traceId, source_refs, data };
  } catch {
    throw new ContractError(
      'GATEWAY_RESPONSE_INVALID',
      'Expected the requested scoped Plane observation and matching sources',
      { trace_id: traceId },
    );
  }
}
