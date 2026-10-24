import type { ReactNode } from 'react';
import { Icon } from './icons';

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Progress({ value, tone = 'cyan' }: { value: number; tone?: string }) {
  return (
    <div className={`progress progress-${tone}`}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Panel({
  title,
  icon,
  action,
  children,
  className = '',
}: {
  title: string;
  icon?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <div className="panel-title">
          {icon ? <Icon name={icon} /> : null}
          <span>{title}</span>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  message,
  trace,
}: {
  title: string;
  message: string;
  trace?: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name="database" />
      </div>
      <h3>{title}</h3>
      <p>{message}</p>
      {trace ? <code>{trace}</code> : null}
    </div>
  );
}

export function QueryError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'WORKBENCH_QUERY_FAILED';
  const trace =
    error && typeof error === 'object' && 'trace_id' in error
      ? String((error as { trace_id?: unknown }).trace_id)
      : undefined;
  return <EmptyState title="Data unavailable" message={message} trace={trace} />;
}

export function MiniBars({ values, tone = 'cyan' }: { values: number[]; tone?: string }) {
  return (
    <div className={`mini-bars bars-${tone}`}>
      {values.map((value, index) => (
        <span key={`${value}-${index}`} style={{ height: `${value}%` }} />
      ))}
    </div>
  );
}
