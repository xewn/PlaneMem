import { ContractError, type ErrorEnvelope } from './errors.js';

export interface VersionPrecondition {
  expected_version?: number;
  if_match?: string;
}

export interface VersionCheckSuccess {
  ok: true;
}

export interface VersionCheckFailure {
  ok: false;
  error: ErrorEnvelope;
}

export type VersionCheck = VersionCheckSuccess | VersionCheckFailure;

export function buildEtag(version: number): string {
  assertVersion(version);
  return `W/"version-${version}"`;
}

export function parseEtag(etag: unknown): number {
  if (typeof etag !== 'string') {
    throw new TypeError('ETag must be a string');
  }
  const match = /^W\/"version-(\d+)"$/.exec(etag);
  if (!match) {
    throw new TypeError('Invalid ETag');
  }
  const version = Number(match[1]);
  assertVersion(version);
  return version;
}

export function checkVersionPrecondition(
  currentVersion: number,
  precondition: VersionPrecondition = {},
): VersionCheck {
  assertVersion(currentVersion);
  if (precondition.expected_version !== undefined) {
    assertVersion(precondition.expected_version);
  }
  const expectedFromEtag =
    precondition.if_match === undefined ? undefined : parseEtag(precondition.if_match);
  if (
    (precondition.expected_version !== undefined &&
      precondition.expected_version !== currentVersion) ||
    (expectedFromEtag !== undefined && expectedFromEtag !== currentVersion)
  ) {
    return {
      ok: false,
      error: new ContractError('VERSION_CONFLICT', 'Resource version does not match precondition', {
        expected_version: precondition.expected_version ?? expectedFromEtag,
        current_version: currentVersion,
        if_match: precondition.if_match,
        retryable: false,
      }).envelope,
    };
  }
  return { ok: true };
}

export function assertVersionPrecondition(
  currentVersion: number,
  precondition: VersionPrecondition = {},
): void {
  const result = checkVersionPrecondition(currentVersion, precondition);
  if (!result.ok) {
    throw new ContractError(result.error.code, result.error.message, result.error.details);
  }
}

function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new RangeError('Version must be a non-negative safe integer');
  }
}
