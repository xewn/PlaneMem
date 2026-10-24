export interface HealthCheck {
  name: string;
  status: 'ok' | 'degraded' | 'down';
  version: string;
  detail?: string;
}

export class HealthRegistry {
  private readonly checks = new Map<string, HealthCheck>();

  set(check: HealthCheck): void {
    this.checks.set(check.name, { ...check });
  }

  snapshot(): {
    status: 'ok' | 'degraded' | 'down';
    ready: boolean;
    checks: HealthCheck[];
    version: '0.1.0';
  } {
    const checks = [...this.checks.values()];
    const status = checks.some((check) => check.status === 'down')
      ? 'down'
      : checks.some((check) => check.status === 'degraded')
        ? 'degraded'
        : 'ok';
    return { status, ready: status !== 'down', checks, version: '0.1.0' };
  }
}
