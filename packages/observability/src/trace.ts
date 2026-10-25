import { createUlid } from '@planemem/contracts';

export interface TraceContext {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  sampled: boolean;
}

export interface SpanRecord extends TraceContext {
  operation: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  status: 'ok' | 'error';
  attributes: Record<string, string | number | boolean>;
}

export function createTraceContext(
  trace_id = `trace_${createUlid()}`,
  parent_span_id?: string,
): TraceContext {
  return {
    trace_id,
    span_id: `span_${createUlid()}`,
    sampled: true,
    ...(parent_span_id === undefined ? {} : { parent_span_id }),
  };
}

export async function withSpan<T>(
  context: TraceContext,
  operation: string,
  work: (span: TraceContext) => Promise<T> | T,
  onComplete?: (record: SpanRecord) => void,
): Promise<T> {
  const span = createTraceContext(context.trace_id, context.span_id);
  const started = Date.now();
  try {
    const value = await work(span);
    onComplete?.({
      ...span,
      operation,
      started_at: new Date(started).toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      status: 'ok',
      attributes: {},
    });
    return value;
  } catch (error) {
    onComplete?.({
      ...span,
      operation,
      started_at: new Date(started).toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      status: 'error',
      attributes: { error: true },
    });
    throw error;
  }
}
