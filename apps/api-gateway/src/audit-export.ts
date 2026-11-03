import { createHash } from 'node:crypto';
import { canExport, canRead } from '@planemem/auth';
import {
  ContractError,
  isUlid,
  parseAuditExportRequest,
  auditExportDocument,
  auditExportDocumentJson,
  parseAuditExportEnvelope,
  parseWorkbenchAuditEnvelope,
  AUDIT_EXPORT_REQUEST_BYTES,
  type WorkbenchAuditRecord,
} from '@planemem/contracts';
import type { PolicyService } from '@planemem/policy-service';
import type { CommandRouter, RequestContext } from './router.js';
import type { WorkbenchRepository } from './workbench/repository.js';

export type AuditExportAudit = (
  context: RequestContext,
  record: WorkbenchAuditRecord,
  phase: 'release' | 'denied',
  bytes: number,
  sha256?: string,
) => Promise<string>;

export function registerAuditExport(
  router: CommandRouter,
  reader: Pick<WorkbenchRepository, 'listAudit'>,
  policy: PolicyService,
  audit: AuditExportAudit | undefined,
) {
  let active = 0;
  router.register('audit.export', async (request) => {
    const context = structuredClone(request.context);
    let releaseId: string | undefined;
    const fail = (code: string, message: string) =>
      new ContractError(code, message, {
        trace_id: context.trace_id,
        retryable: false,
        details: {
          audit_state: releaseId ? 'release-recorded' : 'unconfirmed',
          ...(releaseId ? { release_audit_id: releaseId } : {}),
          client_delivery_state: 'not-confirmed',
        },
      });
    const deadline = Date.now() + 60_000;
    const assertActive = () => {
      if (Date.now() >= deadline)
        throw fail('AUDIT_EXPORT_TIMEOUT', 'Audit export preparation timed out');
      if (
        context.authenticated_client !== true ||
        !context.capability.includes('audit.read') ||
        !context.capability.some((value) =>
          ['data.export', 'data.restricted.export'].includes(value),
        ) ||
        !Number.isFinite(Date.parse(context.token_expires_at ?? '')) ||
        Date.parse(context.token_expires_at!) <= Date.now()
      )
        throw fail(
          'DENIED',
          'A verified audit reader with export permission and a valid session is required',
        );
    };
    assertActive();
    let selection;
    try {
      if (
        context.idempotency_key !== undefined ||
        context.expected_version !== undefined ||
        Buffer.byteLength(JSON.stringify(request.input), 'utf8') > AUDIT_EXPORT_REQUEST_BYTES
      )
        throw new TypeError();
      selection = parseAuditExportRequest(request.input);
    } catch {
      throw fail(
        'INVALID_INPUT',
        'Supply only the reviewed scope, audit ID and SHA-256 without write conditions',
      );
    }
    const selected = selection;
    if (
      Object.keys(selected.scope).some(
        (key) =>
          selected.scope[key as keyof typeof selected.scope] !==
          context[key as keyof typeof selected.scope],
      )
    )
      throw fail('DENIED', 'The reviewed project differs from the current project');
    if (!audit)
      throw fail(
        'AUDIT_PERSISTENCE_UNAVAILABLE',
        'Audit exports require durable release audit persistence',
      );
    if (active >= 2)
      throw fail('AUDIT_EXPORT_BUSY', 'Audit export preparation capacity is occupied');
    const sink = audit;
    const recordAudit = async (
      record: WorkbenchAuditRecord,
      phase: 'release' | 'denied',
      bytes: number,
      sha256?: string,
    ) => {
      try {
        const id = await sink(
          structuredClone(context),
          structuredClone(record),
          phase,
          bytes,
          sha256,
        );
        if (!isUlid(id) || id === record.audit_id) throw new TypeError();
        return id;
      } catch {
        throw fail('AUDIT_PERSISTENCE_UNAVAILABLE', 'Audit export release was not confirmed');
      }
    };
    const read = async () => {
      assertActive();
      const result = await reader.listAudit(
        { ...selected.scope, read_restricted: context.capability.includes('data.restricted.read') },
        context.trace_id,
        { audit_id: selected.audit_id },
      );
      assertActive();
      const page = parseWorkbenchAuditEnvelope(
        result,
        { audit_id: selected.audit_id },
        selected.scope,
        context.trace_id,
      );
      const record = page.data[0];
      if (!record || record.audit_id !== selected.audit_id || page.data.length !== 1)
        throw fail('NOT_FOUND', 'The selected audit record is not available in this scope');
      return structuredClone(record);
    };
    const authorize = async (record: WorkbenchAuditRecord) => {
      assertActive();
      const input = {
        action: 'export.audit',
        resource: { ...selected.scope, classification: record.classification },
        context: {
          ...selected.scope,
          actor_id: context.actor_id,
          client_id: context.client_id,
          trace_id: context.trace_id,
          roles: [...(context.roles ?? [])],
          capabilities: [...context.capability],
          token_expires_at: context.token_expires_at!,
        },
      };
      const allowed =
        canRead(record.classification, context.capability) &&
        canExport(record.classification, context.capability) &&
        policy.authorize(input).allowed &&
        (await policy.authorizeWithOpa(input)).allowed;
      assertActive();
      if (!allowed) {
        await recordAudit(record, 'denied', 0);
        throw fail('DENIED', 'The selected audit record cannot be exported by this reader');
      }
      assertActive();
    };
    active++;
    const work = (async () => {
      try {
        const original = await read();
        await authorize(original);
        const document = auditExportDocument(selected.scope, original);
        const json = auditExportDocumentJson(document);
        const sha256 = createHash('sha256').update(json, 'utf8').digest('hex');
        if (sha256 !== selected.sha256)
          throw fail(
            'AUDIT_EXPORT_CONFLICT',
            'The record view changed; read and review it again before exporting',
          );
        const current = await read();
        if (auditExportDocumentJson(auditExportDocument(selected.scope, current)) !== json)
          throw fail('AUDIT_EXPORT_CONFLICT', 'The record view changed during export preparation');
        await authorize(current);
        assertActive();
        const bytes = Buffer.byteLength(json, 'utf8');
        releaseId = await recordAudit(current, 'release', bytes, sha256);
        assertActive();
        const envelope = parseAuditExportEnvelope(
          {
            schema_version: 1,
            trace_id: context.trace_id,
            source_refs: [
              { type: 'audit', id: current.audit_id },
              { type: 'audit', id: releaseId },
            ],
            data: {
              document,
              document_sha256: sha256,
              document_bytes: bytes,
              release_audit_id: releaseId,
              audit_state: 'release-recorded',
              client_delivery_state: 'not-confirmed',
            },
          },
          selected,
          context.trace_id,
        );
        assertActive();
        return envelope;
      } catch (error) {
        if (error instanceof ContractError) throw error;
        throw fail(
          'WORKBENCH_AUDIT_INVALID',
          'The selected audit view could not be prepared for export',
        );
      } finally {
        active--;
      }
    })();
    // A timeout does not cancel a database/policy/audit operation. Its capacity stays occupied
    // until that work settles, and deadline checks prevent a late result from releasing content.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(fail('AUDIT_EXPORT_TIMEOUT', 'Audit export preparation timed out')),
            Math.max(1, deadline - Date.now()),
          );
          timer.unref();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  });
}
