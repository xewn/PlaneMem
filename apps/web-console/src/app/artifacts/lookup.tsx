import { Panel } from '../../components/ui';

export function ArtifactLookup({
  artifactId = '',
  version = '',
}: {
  artifactId?: string;
  version?: string;
}) {
  return (
    <Panel title="Find a file" icon="search">
      <div className="artifact-lookup-grid">
        <form
          className="artifact-lookup-form"
          method="get"
          action="/artifacts"
          aria-labelledby="artifact-current-heading"
        >
          <h2 id="artifact-current-heading" className="detail-section-title">
            Current record
          </h2>
          <label htmlFor="artifact-current-id">File ID</label>
          <input
            id="artifact-current-id"
            name="artifact"
            defaultValue={artifactId}
            required
            minLength={26}
            maxLength={26}
            pattern="[0-9A-HJKMNP-TV-Z]{26}"
            spellCheck={false}
            autoCapitalize="characters"
          />
          <p className="muted">Read the latest saved file details in this project.</p>
          <button className="primary-button" type="submit">
            Read current metadata
          </button>
        </form>
        <form
          className="artifact-lookup-form"
          method="get"
          action="/artifacts"
          aria-labelledby="artifact-version-heading"
        >
          <h2 id="artifact-version-heading" className="detail-section-title">
            Saved version
          </h2>
          <label htmlFor="artifact-version-id">File ID</label>
          <input
            id="artifact-version-id"
            name="artifact"
            defaultValue={artifactId}
            required
            minLength={26}
            maxLength={26}
            pattern="[0-9A-HJKMNP-TV-Z]{26}"
            spellCheck={false}
            autoCapitalize="characters"
          />
          <label htmlFor="artifact-version-number">Version number</label>
          <input
            id="artifact-version-number"
            name="version"
            defaultValue={version}
            required
            inputMode="numeric"
            pattern="[1-9][0-9]{0,15}"
            maxLength={16}
            spellCheck={false}
          />
          <button className="secondary-button" type="submit">
            Read saved version
          </button>
        </form>
      </div>
    </Panel>
  );
}
