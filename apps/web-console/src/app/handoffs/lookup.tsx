import { Panel } from '../../components/ui';
import Link from 'next/link';

/** Direct navigation remains available even when dashboard/list reads fail. */
export function HandoffLookup() {
  return (
    <Panel title="Open saved records" icon="handoffs">
      <div className="side-detail">
        <Link className="panel-link" href="/handoffs/recover" prefetch={false}>
          Recover an original handoff request in this tab
        </Link>
        <details>
          <summary>Open a handoff by ID</summary>
          <form
            className="handoff-form"
            action="/handoffs/detail"
            method="get"
            target="_blank"
            rel="noreferrer"
          >
            <label>
              Handoff ID
              <input
                name="handoff"
                required
                minLength={26}
                maxLength={26}
                pattern="[0-9A-HJKMNP-TV-Z]{26}"
                spellCheck={false}
                autoCapitalize="characters"
              />
            </label>
            <button className="secondary-button" type="submit">
              Open current details ↗
            </button>
          </form>
        </details>
        <details>
          <summary>Prepare a handoff from a saved checkpoint</summary>
          <form
            className="handoff-form"
            action="/handoffs/create"
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
            <label>
              Checkpoint ID
              <input
                name="checkpoint"
                required
                minLength={26}
                maxLength={26}
                pattern="[0-9A-HJKMNP-TV-Z]{26}"
                spellCheck={false}
                autoCapitalize="characters"
              />
            </label>
            <button className="secondary-button" type="submit">
              Review this checkpoint ↗
            </button>
          </form>
        </details>
        <p className="muted">
          The record forms above open a separate tab and check current access. Opening a record does
          not create, claim or resume a handoff.
        </p>
      </div>
    </Panel>
  );
}
