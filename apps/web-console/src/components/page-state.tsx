import Link from 'next/link';
import { AuthRequiredError } from '../lib/server-api';
import { EmptyState, QueryError } from './ui';

export function LoginRequired() {
  return (
    <div className="panel">
      <EmptyState
        title="Sign in required"
        message="The workbench only renders scoped data after the Hedou AuthServer session is established."
      />
      <div style={{ textAlign: 'center', paddingBottom: 26 }}>
        <Link className="primary-button" href="/login">
          Sign in
        </Link>
      </div>
    </div>
  );
}

export function PageError({ error }: { error: unknown }) {
  return error instanceof AuthRequiredError ? (
    <LoginRequired />
  ) : (
    <div className="panel">
      <QueryError error={error} />
    </div>
  );
}

export function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function textValue(value: unknown, fallback = '—'): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export function toneFor(value: unknown): string {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized.includes('block') || normalized.includes('denied') || normalized.includes('error'))
    return 'red';
  if (
    normalized.includes('review') ||
    normalized.includes('proposed') ||
    normalized.includes('pending')
  )
    return 'yellow';
  if (
    normalized.includes('done') ||
    normalized.includes('confirmed') ||
    normalized.includes('allowed') ||
    normalized.includes('running')
  )
    return 'green';
  if (
    normalized.includes('active') ||
    normalized.includes('progress') ||
    normalized.includes('latest')
  )
    return 'cyan';
  return 'neutral';
}
