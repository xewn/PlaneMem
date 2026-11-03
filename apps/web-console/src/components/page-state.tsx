import Link from 'next/link';
import { AuthRequiredError, WorkbenchApiError } from '../lib/server-api';
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
  if (error instanceof AuthRequiredError) return <LoginRequired />;
  if (error instanceof WorkbenchApiError && error.status === 403)
    return (
      <div className="panel">
        <EmptyState
          title="Access denied"
          message="Your account cannot read this view in the selected project."
          trace={error.trace_id}
        />
      </div>
    );
  return (
    <div className="panel">
      <QueryError error={error} />
    </div>
  );
}

export { numberValue, textValue, toneFor } from './record-format';
