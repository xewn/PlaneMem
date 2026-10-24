import { ContractError, type ErrorEnvelope } from '@planemem/contracts';

export interface PlaneCapabilityMatrix {
  plane_version: string;
  connector_version: string;
  api_version: string;
  webhook_version: string;
  image_digest: string;
  features: Record<string, boolean>;
}

export type CapabilityCheck =
  | { supported: true; capability: string; plane_version: string }
  | { supported: false; error: ErrorEnvelope };

export function assertSupported(
  matrix: PlaneCapabilityMatrix,
  capability: string,
  planeVersion: string,
): CapabilityCheck {
  if (matrix.plane_version !== planeVersion) {
    throw new ContractError(
      'PLANE_VERSION_UNSUPPORTED',
      'Plane version is not in the compatibility matrix',
      {
        expected_version: matrix.plane_version,
        received_version: planeVersion,
        trace_id: 'trace_plane_compatibility',
        retryable: false,
      },
    );
  }
  if (matrix.features[capability] !== true) {
    return {
      supported: false,
      error: new ContractError(
        'PLANE_CAPABILITY_UNSUPPORTED',
        'Plane capability is not supported',
        {
          capability,
          plane_version: planeVersion,
          trace_id: 'trace_plane_compatibility',
          retryable: false,
        },
      ).envelope,
    };
  }
  return { supported: true, capability, plane_version: planeVersion };
}
