import { parseObservedRecordId, validateIdempotencyKey } from '@planemem/contracts';

export function planeOrigin(value: string): URL {
  if (typeof value !== 'string' || value.trim() !== value || /[\\\u0000-\u001f\u007f]/.test(value))
    throw new TypeError('Expected a valid Plane origin');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Expected a valid Plane origin');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new TypeError(
      'base_url must be an HTTP(S) origin without credentials, path, query or fragment',
    );
  return url;
}

export function planeSegment(value: unknown): string {
  const id = parseObservedRecordId(value);
  if (/[\\/%?#]/.test(id))
    throw new TypeError('Plane identifiers cannot contain path separators or URL delimiters');
  return encodeURIComponent(id);
}

export function planeTrace(value: unknown): string {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,1024}$/.test(value))
    throw new TypeError('Expected a visible ASCII trace ID of at most 1024 characters');
  return value;
}

export function planeToken(value: unknown): string {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(value))
    throw new TypeError('Expected a nonempty bearer credential without whitespace');
  return value;
}

export function planeEtag(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    !/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(value)
  )
    throw new TypeError('Expected one opaque Plane ETag; wildcard preconditions are not accepted');
  return value;
}

export function planeRequestKey(value: unknown): string {
  validateIdempotencyKey(value);
  if (typeof value !== 'string' || !/^[\x21-\x7e]+$/.test(value))
    throw new TypeError('Expected an ASCII request key');
  return value;
}

/** If-None-Match uses the opaque value; either validator may have a weak prefix. */
export function planeEtagsWeaklyMatch(left: string, right: string): boolean {
  return planeEtag(left).replace(/^W\//, '') === planeEtag(right).replace(/^W\//, '');
}

export function planeCursor(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 2048 ||
    /[\u0000-\u001f\u007f\p{Cs}]/u.test(value)
  )
    throw new TypeError('Invalid Plane pagination cursor');
  return value;
}

/** Reject lossy JSON conversions, getters and excessive nesting before dispatch. */
export function planeJson(value: unknown, maxBytes: number): string {
  const ancestors = new Set<object>();
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 100_000 || depth > 64)
      throw new TypeError('Plane JSON exceeds the structure limit');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object') throw new TypeError('Expected lossless JSON data');
    if (ancestors.has(item)) throw new TypeError('Plane JSON cannot contain cycles');
    const array = Array.isArray(item);
    if (
      !array &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      throw new TypeError('Plane JSON must use plain objects');
    const names = Reflect.ownKeys(item);
    if (names.some((key) => typeof key !== 'string'))
      throw new TypeError('Plane JSON cannot contain symbol keys');
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (array && (names.length !== item.length + 1 || item.length > 100_000))
      throw new TypeError('Plane JSON requires dense arrays');
    ancestors.add(item);
    for (const name of names as string[]) {
      if (array && name === 'length') continue;
      const descriptor = descriptors[name]!;
      if (
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value') ||
        (array && (!/^(0|[1-9][0-9]*)$/.test(name) || Number(name) >= item.length))
      )
        throw new TypeError('Plane JSON cannot contain accessors or custom array fields');
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
  };
  visit(value, 0);
  const result = JSON.stringify(value);
  if (typeof result !== 'string' || new TextEncoder().encode(result).byteLength > maxBytes)
    throw new TypeError('Plane JSON exceeds the byte limit');
  return result;
}

export function planeInteger(value: number, min: number, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError(`${name} must be between ${min} and ${max}`);
  return value;
}
