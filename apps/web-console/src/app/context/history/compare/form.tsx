import { contextHistoryHref, type ContextComparisonNavigation } from '../../navigation';

export function ContextComparisonForm({
  navigation,
  versions,
}: {
  navigation: ContextComparisonNavigation;
  versions?: number[];
}) {
  const fields = new URLSearchParams(contextHistoryHref(navigation.history).split('?')[1]);
  return (
    <form
      action="/context/history/compare"
      method="get"
      className="artifact-lookup-form"
      key={JSON.stringify([navigation, versions])}
    >
      {Array.from(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label htmlFor="context-compare-from">Base version</label>
      {versions ? (
        <select
          id="context-compare-from"
          name="from"
          defaultValue={navigation.from_version}
          required
        >
          {versions.map((version) => (
            <option key={version} value={version}>
              Version {version}
            </option>
          ))}
        </select>
      ) : (
        <input
          id="context-compare-from"
          name="from"
          type="text"
          inputMode="numeric"
          pattern="[1-9][0-9]{0,15}"
          maxLength={16}
          defaultValue={navigation.from_version ?? ''}
          required
        />
      )}
      <label htmlFor="context-compare-to">Comparison version</label>
      {versions ? (
        <select id="context-compare-to" name="to" defaultValue={navigation.to_version} required>
          {versions.map((version) => (
            <option key={version} value={version}>
              Version {version}
            </option>
          ))}
        </select>
      ) : (
        <input
          id="context-compare-to"
          name="to"
          type="text"
          inputMode="numeric"
          pattern="[1-9][0-9]{0,15}"
          maxLength={16}
          defaultValue={navigation.to_version ?? ''}
          required
        />
      )}
      <p className="muted">
        Choose two different recorded versions. Their order is kept; neither selection changes to
        the latest version.
      </p>
      <button className="primary-button" type="submit">
        Compare selected versions
      </button>
    </form>
  );
}
