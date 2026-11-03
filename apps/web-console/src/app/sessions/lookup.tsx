import { Panel } from '../../components/ui';
import Link from 'next/link';

/** Keep a route to one session even when the registry cannot be read. */
export function SessionLookup() {
  return (
    <Panel title="Open a saved session" icon="sessions">
      <Link className="panel-link" href="/sessions/recover" prefetch={false}>
        Recover an original session or activity request in this tab
      </Link>
      <details>
        <summary>Read session state and recover earlier requests by ID</summary>
        <form
          className="handoff-form"
          action="/sessions/detail"
          method="get"
          target="_blank"
          rel="noreferrer"
        >
          <label>
            Session ID
            <input
              name="session"
              required
              minLength={26}
              maxLength={26}
              pattern="[0-9A-HJKMNP-TV-Z]{26}"
              spellCheck={false}
              autoCapitalize="characters"
            />
          </label>
          <button className="secondary-button" type="submit">
            Open session state ↗
          </button>
          <p className="muted">
            Opens in a new tab. Read the current record, save a checkpoint or recover an earlier
            checkpoint or close request. Opening the page does not submit a command.
          </p>
        </form>
      </details>
    </Panel>
  );
}
