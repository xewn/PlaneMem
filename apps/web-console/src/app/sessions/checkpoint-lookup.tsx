import Link from 'next/link';
import { isUlid } from '@planemem/contracts';

/** Independent of a successful history/detail read; never invent a continuation cursor. */
export function CheckpointLookup({ session }: { session?: string }) {
  const savedSession = isUlid(session) ? session : '';
  return (
    <section aria-label="Checkpoint lookup and request recovery">
      <p>
        Incomplete reads do not show partial notes or confirm whether an earlier save succeeded.
      </p>
      <div className="heading-actions">
        {savedSession && (
          <Link
            className="panel-link"
            prefetch={false}
            href={{ pathname: '/sessions/history', query: { session: savedSession } }}
          >
            Latest revisions
          </Link>
        )}
        <Link className="panel-link" href="/sessions/recover" prefetch={false}>
          Recover an original request in this tab
        </Link>
      </div>
      <details>
        <summary>Find checkpoint history by session and revision</summary>
        <form className="handoff-form" action="/sessions/history" method="get">
          <label>
            Session ID
            <input
              name="session"
              defaultValue={savedSession}
              required
              minLength={26}
              maxLength={26}
              pattern="[0-9A-HJKMNP-TV-Z]{26}"
              spellCheck={false}
              autoCapitalize="characters"
            />
          </label>
          <label>
            Before revision
            <input
              name="before"
              required
              type="number"
              min={1}
              max={Number.MAX_SAFE_INTEGER}
              step={1}
            />
          </label>
          <p className="muted">
            Use a known revision number to read older records. This does not recover a missing page
            or confirm a save.
          </p>
          <button className="secondary-button" type="submit">
            Read older revisions
          </button>
        </form>
      </details>
      <details>
        <summary>Read one checkpoint by its saved ID</summary>
        <form className="handoff-form" action="/sessions/checkpoint" method="get">
          <label>
            Session ID
            <input
              name="session"
              defaultValue={savedSession}
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
            Read checkpoint
          </button>
        </form>
      </details>
    </section>
  );
}
