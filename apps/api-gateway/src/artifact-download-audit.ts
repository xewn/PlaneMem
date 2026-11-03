import type { ServerResponse } from 'node:http';
import type { ArtifactDownloadQuery } from '@planemem/contracts';
import type { RequestContext } from './router.js';

export type ArtifactDownloadFailureStage =
  | 'metadata-read'
  | 'metadata-validation'
  | 'descriptor-validation'
  | 'authorization'
  | 'storage-read'
  | 'content-validation'
  | 'recheck'
  | 'release-audit'
  | 'denied-audit'
  | 'adapter-validation';
export type ArtifactDownloadTransportOutcome = 'finished' | 'closed' | 'error' | 'timeout';
export type ArtifactDownloadObservation =
  | { kind: 'failure'; stage: ArtifactDownloadFailureStage; release_audit_id?: string }
  | {
      kind: 'transport';
      transport: 'http' | 'mcp';
      outcome: ArtifactDownloadTransportOutcome;
      release_audit_id: string;
    };
export type ArtifactDownloadObserver = (
  context: RequestContext,
  query: ArtifactDownloadQuery,
  event: ArtifactDownloadObservation,
) => Promise<void>;

/** Optional observations cannot replace the mandatory pre-release audit or the original error. */
export function boundedArtifactDownloadObserver(
  sink: ArtifactDownloadObserver,
): ArtifactDownloadObserver {
  let pending = 0;
  return async (context, query, event) => {
    // Timed-out writes retain their slot until the underlying sink actually settles.
    // A stalled sink therefore cannot accumulate an unlimited background queue.
    if (pending >= 8) return;
    pending++;
    const write = Promise.resolve()
      .then(() => sink(structuredClone(context), { ...query }, { ...event }))
      .catch(() => undefined)
      .finally(() => {
        pending--;
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 5_000);
      timer.unref();
    });
    try {
      await Promise.race([write, deadline]);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** A finish event concerns the server transport only, never client receipt or storage. */
export function observeArtifactDownloadTransport(response: ServerResponse): {
  completion: Promise<ArtifactDownloadTransportOutcome>;
  fail: () => void;
} {
  let fail = () => {};
  const completion = new Promise<ArtifactDownloadTransportOutcome>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const complete = (outcome: ArtifactDownloadTransportOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      response.off('finish', finished);
      response.off('close', closed);
      response.off('error', failed);
      resolve(outcome);
    };
    const finished = () => complete('finished');
    const closed = () => complete(response.writableFinished ? 'finished' : 'closed');
    const failed = () => {
      if (settled) return;
      complete('error');
      response.destroy();
    };
    fail = failed;
    if (response.writableFinished) finished();
    else if (response.destroyed) closed();
    else {
      response.once('finish', finished);
      response.once('close', closed);
      response.once('error', failed);
      timer = setTimeout(() => {
        complete('timeout');
        response.destroy();
      }, 60_000);
      timer.unref();
    }
  });
  return { completion, fail: () => fail() };
}
