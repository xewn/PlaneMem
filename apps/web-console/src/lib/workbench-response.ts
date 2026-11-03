import { readArtifactTransferBytes } from './artifact-transfer';

/** The caller supplies the decoded success limit and the request's existing abort signal. */
export async function readWorkbenchJsonResponse(
  response: Response,
  signal: AbortSignal,
  maximumBytes: number,
  errorBytes = 16 * 1024,
): Promise<unknown> {
  try {
    if (response.ok && response.status !== 200) throw new TypeError();
    if (
      !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
        response.headers.get('content-type') ?? '',
      )
    )
      throw new TypeError();
    const maximum = response.ok ? maximumBytes : errorBytes;
    const declared = response.headers.get('content-length');
    let expected: number | undefined;
    if (declared !== null) {
      if (!/^(0|[1-9][0-9]{0,15})$/.test(declared) || !Number.isSafeInteger(Number(declared)))
        throw new TypeError();
      // Fetch exposes decoded bytes; a compressed wire length cannot be their expected length.
      const encoding = response.headers.get('content-encoding');
      if (encoding === null || encoding.toLowerCase() === 'identity') expected = Number(declared);
    }
    const bytes = await readArtifactTransferBytes(response.body, maximum, signal, expected);
    const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (signal.aborted) throw new TypeError();
    return result;
  } catch {
    void response.body?.cancel().catch(() => undefined);
    throw new TypeError(
      'Workbench response was incomplete, invalid or larger than its read limit.',
    );
  }
}
