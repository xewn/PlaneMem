import { Panel } from '../../components/ui';
import Link from 'next/link';

/** This entry survives directory and detail failures and never submits a decision. */
export function ConflictLookup() {
  return (
    <Panel title="Open a conflict by ID" icon="conflicts">
      <form
        className="handoff-form"
        action="/conflicts/detail"
        method="get"
        target="_blank"
        rel="noreferrer"
      >
        <label>
          Conflict ID
          <input name="conflict" required maxLength={255} spellCheck={false} />
        </label>
        <button className="secondary-button" type="submit">
          Read conflict details ↗
        </button>
        <p className="muted">
          Opens an independent view in a new tab. Opening it does not record a decision or confirm
          an earlier request.
        </p>
      </form>
      <Link
        className="panel-link"
        href="/conflicts/receipt"
        target="_blank"
        rel="noreferrer"
        prefetch={false}
      >
        Check a saved original decision request ↗
      </Link>
      <Link className="panel-link" href="/conflicts/recover" prefetch={false}>
        Recover a saved original decision
      </Link>
    </Panel>
  );
}
