import type { IncomingMessage } from 'node:http';
import { ContractError } from '@planemem/contracts';
import { readBoundedArtifactUploadBody } from '../artifact-upload.js';

export const MCP_JSON_BODY_BYTES = 1024 * 1024;

export function mcpContentLength(request: IncomingMessage, trace: string): number | undefined {
  const length = request.headers['content-length'];
  if (length === undefined) return;
  if (
    typeof length !== 'string' ||
    !/^(0|[1-9][0-9]*)$/.test(length) ||
    !Number.isSafeInteger(Number(length))
  )
    throw new ContractError('INVALID_INPUT', 'Invalid MCP content length', { trace_id: trace });
  return Number(length);
}

export async function readMcpJson(
  request: IncomingMessage,
  maximum: number,
  trace: string,
  extension?: { maximum: number; acquire: () => void },
) {
  const type = request.headers['content-type'];
  const encoding = request.headers['content-encoding'];
  const length = mcpContentLength(request, trace);
  if (
    typeof type !== 'string' ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type) ||
    (encoding !== undefined && encoding !== 'identity')
  )
    throw new ContractError('INVALID_INPUT', 'MCP requires uncompressed UTF-8 JSON', {
      trace_id: trace,
    });
  if (length !== undefined && length > (extension?.maximum ?? maximum))
    throw new ContractError('ARTIFACT_TOO_LARGE', 'MCP body exceeds the permitted byte limit', {
      trace_id: trace,
    });
  let initialLimit = maximum;
  if (length !== undefined && length > maximum && extension) {
    extension.acquire();
    initialLimit = extension.maximum;
  }
  const bytes = await readBoundedArtifactUploadBody(
    request,
    initialLimit,
    trace,
    initialLimit === maximum ? extension : undefined,
  );
  if (length !== undefined && bytes.byteLength !== length)
    throw new ContractError('INVALID_INPUT', 'MCP body length differs', { trace_id: trace });
  const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError();
  return { body: body as Record<string, unknown>, bytes: bytes.byteLength };
}
