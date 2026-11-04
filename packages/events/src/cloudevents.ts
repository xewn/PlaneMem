import { ContractError, syncJsonSnapshot } from '@planemem/contracts';
import { validateEvent, type CanonicalEvent, type EventType } from './envelope.js';

export const CANONICAL_CLOUDEVENT_CONTENT_TYPE = 'application/cloudevents+json';
export const MAX_CANONICAL_CLOUDEVENT_BYTES = 1024 * 1024;

/** Source is explicit producer context on encode, an exact expected value on decode. */
export interface CanonicalCloudEventOptions {
  source: string;
}

/** Closed PlaneMem profile; data contains the complete original canonical envelope. */
export interface CanonicalCloudEvent {
  specversion: '1.0';
  id: string;
  source: string;
  type: `com.planemem.${EventType}.v1`;
  datacontenttype: 'application/json';
  subject: string;
  time: string;
  data: CanonicalEvent;
}

const CLOUD_FIELDS = [
  'specversion',
  'id',
  'source',
  'type',
  'datacontenttype',
  'subject',
  'time',
  'data',
];
const EVENT_FIELDS = [
  'event_id',
  'event_type',
  'schema_version',
  'tenant_id',
  'workspace_id',
  'project_id',
  'aggregate_type',
  'aggregate_id',
  'aggregate_version',
  'actor_id',
  'client_id',
  'session_id',
  'correlation_id',
  'causation_id',
  'occurred_at',
  'trace_id',
  'source_refs',
  'sensitivity',
  'payload',
];
const ID_FIELDS = [
  'event_id',
  'tenant_id',
  'workspace_id',
  'project_id',
  'aggregate_id',
  'actor_id',
  'session_id',
  'correlation_id',
  'causation_id',
];

/** Returns a detached structured JSON object. Does not publish or authenticate an event. */
export function toCanonicalCloudEvent(
  event: unknown,
  options: CanonicalCloudEventOptions,
): CanonicalCloudEvent {
  return convert(event, options, false);
}

/** Checks the complete profile and exact expected source before returning detached data. */
export function fromCanonicalCloudEvent(
  value: unknown,
  options: CanonicalCloudEventOptions,
): CanonicalEvent {
  return convert(value, options, true).data;
}

function convert(
  input: unknown,
  options: CanonicalCloudEventOptions,
  fromStructured: boolean,
): CanonicalCloudEvent {
  let traceId = 'trace_unknown';
  try {
    // Snapshot before inspecting any event fields; never mutate or return caller objects.
    const captured: unknown = JSON.parse(syncJsonSnapshot(input, MAX_CANONICAL_CLOUDEVENT_BYTES));
    assertScalarStrings(captured);
    const outer = fromStructured ? row(captured, CLOUD_FIELDS, true) : undefined;
    const data = row(outer ? outer.data : captured, EVENT_FIELDS);
    if (
      typeof data.trace_id === 'string' &&
      data.trace_id.length > 0 &&
      data.trace_id.length <= 1024 &&
      !/[\u0000-\u001f\u007f]/u.test(data.trace_id)
    )
      traceId = data.trace_id;

    const settings = row(JSON.parse(syncJsonSnapshot(options, 4096)), ['source'], true);
    const source = parseSource(settings.source);
    // The legacy ULID regex uses $, which can also match before a final newline.
    for (const field of ID_FIELDS) {
      const id = data[field];
      if (id !== undefined && (typeof id !== 'string' || id.length !== 26))
        throw new TypeError('Invalid identifier length');
    }
    if (
      data.client_id !== undefined &&
      (typeof data.client_id !== 'string' || data.client_id.length === 0)
    )
      throw new TypeError('Invalid client_id');
    assertProfileTime(data.occurred_at);
    const result = validateEvent(data);
    if (!result.valid) throw new TypeError('Invalid canonical event');
    const event = result.event;
    const expected: CanonicalCloudEvent = {
      specversion: '1.0',
      id: event.event_id,
      source,
      type: `com.planemem.${event.event_type}.v1`,
      datacontenttype: 'application/json',
      subject: `${encodeURIComponent(event.aggregate_type)}/${event.aggregate_id}`,
      time: event.occurred_at,
      data: event,
    };
    if (outer) {
      for (const field of [
        'specversion',
        'id',
        'source',
        'type',
        'datacontenttype',
        'subject',
        'time',
      ] as const) {
        if (outer[field] !== expected[field]) throw new TypeError('CloudEvent mapping mismatch');
      }
    }
    // The limit includes the added wrapper; a standalone event fitting 1 MiB may not fit it.
    return JSON.parse(
      syncJsonSnapshot(expected, MAX_CANONICAL_CLOUDEVENT_BYTES),
    ) as CanonicalCloudEvent;
  } catch {
    // Never include arbitrary input, payload or an exception message in the error envelope.
    throw new ContractError(
      'CLOUDEVENT_VALIDATION_FAILED',
      'Invalid canonical CloudEvent profile',
      {
        trace_id: traceId,
        retryable: false,
      },
    );
  }
}

function row(
  value: unknown,
  fields: readonly string[],
  allRequired = false,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((field) => !fields.includes(field)) ||
    (allRequired && fields.some((field) => !Object.hasOwn(value, field)))
  )
    throw new TypeError('Invalid profile fields');
  return value as Record<string, unknown>;
}

function parseSource(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !/^[A-Za-z][A-Za-z0-9+.-]*:[A-Za-z0-9:/?#\[\]@!$&'()*+,;=._~%\-]+$/.test(value) ||
    /[\s\u0000-\u001f\u007f]/u.test(value) ||
    /%(?![0-9A-Fa-f]{2})/.test(value)
  )
    throw new TypeError('Invalid source');
  // WHATWG URL alone also accepts characters that RFC 3986 would percent-encode.
  // Brackets are allowed only in the authority's IP literal, never in userinfo or a path.
  const body = value.slice(value.indexOf(':') + 1);
  const authority = body.startsWith('//') ? body.slice(2).split(/[/?#]/, 1)[0]! : '';
  const rest = body.startsWith('//') ? body.slice(2 + authority.length) : body;
  const userinfo = authority.includes('@') ? authority.slice(0, authority.indexOf('@')) : '';
  if (
    /[\[\]]/.test(rest) ||
    /[\[\]]/.test(userinfo) ||
    authority.split('@').length > 2 ||
    rest.split('#').length > 2
  )
    throw new TypeError('Invalid URI components');
  // Parsing is an additional profile restriction, not normalization or a network lookup.
  new URL(value);
  return value;
}

function assertProfileTime(value: unknown): void {
  if (typeof value !== 'string') throw new TypeError('Invalid time');
  const parts =
    /^(?!0000)([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,9})?Z$(?![\s\S])/.exec(
      value,
    );
  if (!parts) throw new TypeError('Invalid time');
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > days[month - 1]!) throw new TypeError('Invalid calendar date');
}

/** Called only after the shared finite-JSON depth/node/byte bounds have passed. */
function assertScalarStrings(value: unknown): void {
  if (typeof value === 'string') {
    if (/\p{Cs}/u.test(value)) throw new TypeError('Invalid Unicode scalar string');
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (/\p{Cs}/u.test(key)) throw new TypeError('Invalid Unicode scalar key');
      assertScalarStrings(child);
    }
  }
}
