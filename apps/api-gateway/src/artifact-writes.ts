import {
  ContractError,
  assertArtifactReceiptIdentity,
  parseArtifactReceiptQuery,
  parseArtifactUploadEnvelope,
} from '@planemem/contracts';
import type { PersistentArtifactService } from '@planemem/artifact-service';
import { publicArtifactMetadata } from './artifact-reads.js';
import type { CommandRouter } from './router.js';

/** Providers must enforce visibility and verify immutable object bytes before committing. */
export type ArtifactWriter = Pick<PersistentArtifactService, 'createArtifact' | 'putVersion'>;

export function registerArtifactWrites(router: CommandRouter, writer: ArtifactWriter | undefined) {
  for (const operation of ['artifact.create', 'artifact.put-version'] as const) {
    router.register(operation, async (request) => {
      const context = { ...request.context, capability: [...request.context.capability] };
      const fail = (code: string, message: string) =>
        new ContractError(code, message, {
          trace_id: context.trace_id,
        });
      if (context.authenticated_client !== true || !context.capability.includes('artifact.write'))
        throw fail('ARTIFACT_ACCESS_DENIED', 'A verified artifact writer is required');
      let query;
      try {
        const fields =
          operation === 'artifact.create'
            ? ['request', 'content']
            : ['request', 'content', 'artifact_id'];
        if (Object.keys(request.input).some((key) => !fields.includes(key))) throw new TypeError();
        query = parseArtifactReceiptQuery(request.input.request);
        if (
          query.command.operation !== operation ||
          !(request.input.content instanceof Uint8Array) ||
          request.input.content.byteLength !== query.command.size ||
          context.idempotency_key !== query.command.request_key
        )
          throw new TypeError();
        if (query.command.operation === 'artifact.put-version') {
          if (
            request.input.artifact_id !== query.command.artifact_id ||
            context.expected_version !== query.command.expected_version
          )
            throw new TypeError();
        } else if (context.expected_version !== undefined) throw new TypeError();
      } catch {
        throw fail(
          'INVALID_INPUT',
          'Supply the original command, bytes and matching write conditions',
        );
      }
      try {
        assertArtifactReceiptIdentity(query.identity, context);
      } catch {
        throw fail(
          'ARTIFACT_ACCESS_DENIED',
          'The original artifact identity differs from the verified session',
        );
      }
      if (!writer)
        throw fail('ARTIFACT_STORAGE_UNAVAILABLE', 'Persistent artifact writes are not configured');
      if (
        query.command.operation === 'artifact.create' &&
        query.command.classification === 'restricted' &&
        !context.capability.includes('data.restricted.read')
      )
        throw fail('ARTIFACT_ACCESS_DENIED', 'Restricted artifact access is required');
      const access = {
        ...query.identity,
        trace_id: context.trace_id,
        capabilities: [...context.capability],
      };
      const command = parseArtifactReceiptQuery(query).command;
      const bytes = new Uint8Array(request.input.content as Uint8Array);
      const saved =
        command.operation === 'artifact.create'
          ? await writer.createArtifact(access, command, bytes)
          : await writer.putVersion(access, command, bytes);
      let result;
      try {
        if (
          !saved ||
          saved.trace_id !== context.trace_id ||
          Object.keys(saved).some(
            (key) => !['status', 'artifact', 'replayed', 'trace_id'].includes(key),
          )
        )
          throw new TypeError();
        const artifact = publicArtifactMetadata(saved.artifact);
        result = parseArtifactUploadEnvelope(
          {
            schema_version: 1,
            trace_id: saved.trace_id,
            source_refs: [
              { type: 'artifact', id: artifact.artifact_id, revision: artifact.version },
            ],
            data: {
              ...query,
              status: saved.status,
              artifact,
              replayed: saved.replayed,
              content_state: saved.replayed === false ? 'verified-at-save' : 'not-checked',
            },
          },
          query,
          context.trace_id,
        );
      } catch {
        throw fail(
          'ARTIFACT_STORED_INVALID',
          'Artifact write result is invalid; keep the original request',
        );
      }
      if (
        result.data.artifact.classification === 'restricted' &&
        !context.capability.includes('data.restricted.read')
      )
        throw fail('ARTIFACT_ACCESS_DENIED', 'Restricted artifact access is required');
      return result;
    });
  }
}
