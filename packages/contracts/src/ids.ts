const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export type Ulid = string & { readonly __ulid: unique symbol };

function encodeBase32(value: bigint, length: number): string {
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output = CROCKFORD[Number(value & 31n)] + output;
    value >>= 5n;
  }
  return output;
}

export function isUlid(value: unknown): value is Ulid {
  return typeof value === 'string' && ULID_PATTERN.test(value);
}

export function assertUlid(value: unknown): asserts value is Ulid {
  if (!isUlid(value)) {
    throw new TypeError('Invalid ULID');
  }
}

export function createUlid(timestamp = Date.now()): Ulid {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 281_474_976_710_655) {
    throw new RangeError('ULID timestamp must be a non-negative safe integer within 48 bits');
  }
  const random = new Uint8Array(10);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(random);
  } else {
    for (let index = 0; index < random.length; index += 1) {
      random[index] = Math.floor(Math.random() * 256);
    }
  }
  const randomValue = random.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
  return `${encodeBase32(BigInt(timestamp), 10)}${encodeBase32(randomValue, 16)}` as Ulid;
}
