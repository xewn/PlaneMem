import type { PlatformEventBusOptions } from './event-bus.js';

/** Explicit production enablement; an absent URL never selects an in-memory replacement. */
export function eventBusFromEnvironment(
  env: NodeJS.ProcessEnv,
): PlatformEventBusOptions | undefined {
  if (env.EVENT_BUS_ENABLED === undefined || env.EVENT_BUS_ENABLED === 'false') return undefined;
  if (env.EVENT_BUS_ENABLED !== 'true')
    throw new TypeError('EVENT_BUS_ENABLED must be true or false');
  const servers = env.NATS_URL?.split(',').map((value) => value.trim());
  if (!servers?.length || servers.some((value) => !value))
    throw new TypeError('NATS_URL is required when the event bus is enabled');
  for (const server of servers) {
    const url = new URL(server);
    if (
      !['nats:', 'tls:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname && url.pathname !== '/')
    )
      throw new TypeError('Supply NATS endpoints without embedded credentials or URL paths');
  }
  const replicas = Number(env.EVENT_BUS_REPLICAS ?? '1');
  const max_bytes = Number(env.EVENT_BUS_MAX_BYTES ?? '1073741824');
  if (
    (replicas !== 1 && replicas !== 3) ||
    !Number.isSafeInteger(max_bytes) ||
    max_bytes < 1024 * 1024
  )
    throw new TypeError('Invalid event bus replicas or storage limit');
  return {
    connection: { servers, ...(env.NATS_TOKEN ? { token: env.NATS_TOKEN } : {}) },
    stream: env.EVENT_BUS_STREAM ?? 'PLANEMEM_EVENTS_V1',
    subject_prefix: env.EVENT_BUS_SUBJECT_PREFIX ?? 'planemem.events.v1',
    replicas,
    max_bytes,
  };
}
