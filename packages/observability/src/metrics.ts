export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

  increment(name: string, labels: Record<string, string> = {}, value = 1): void {
    this.assertCardinality(labels);
    const key = `${name}${serializeLabels(labels)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    this.assertCardinality(labels);
    this.gauges.set(`${name}${serializeLabels(labels)}`, value);
  }

  snapshot(): { counters: Record<string, number>; gauges: Record<string, number> } {
    return { counters: Object.fromEntries(this.counters), gauges: Object.fromEntries(this.gauges) };
  }

  private assertCardinality(labels: Record<string, string>): void {
    for (const [key, value] of Object.entries(labels))
      if (key.endsWith('_id') || key === 'trace_id')
        throw new Error(`high-cardinality label is forbidden: ${key}=${value}`);
  }
}

function serializeLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  return entries.length === 0
    ? ''
    : `{${entries.map(([key, value]) => `${key}=${value}`).join(',')}}`;
}
