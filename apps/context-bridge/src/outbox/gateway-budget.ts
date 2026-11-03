import { ContractError } from '@planemem/contracts';

/** Bounds local waiting, including credential providers/fetch implementations that ignore abort. */
export function syncPublishBudget(trace: string, timeout: number, external?: AbortSignal) {
  const controller = new AbortController();
  const deadline = performance.now() + timeout;
  const abort = () => controller.abort();
  external?.addEventListener('abort', abort, { once: true });
  if (external?.aborted) abort();
  const timer = setTimeout(abort, timeout);
  const stopped = () =>
    new ContractError(
      external?.aborted ? 'SYNC_PUBLISH_CANCELED' : 'SYNC_PUBLISH_TIMEOUT',
      'Stopped waiting for the original sync batch; delivery may still have completed',
      { trace_id: trace, retryable: true },
    );
  const check = () => {
    if (controller.signal.aborted || performance.now() >= deadline) {
      abort();
      throw stopped();
    }
  };
  return {
    signal: controller.signal,
    check,
    wait<T>(start: () => T | PromiseLike<T>, discard?: (value: T) => void): Promise<T> {
      check();
      return new Promise<T>((resolve, reject) => {
        let done = false;
        const remove = () => controller.signal.removeEventListener('abort', onAbort);
        const onAbort = () => {
          if (done) return;
          done = true;
          remove();
          reject(stopped());
        };
        const drop = (value: T) => {
          try {
            discard?.(value);
          } catch {
            /* Best-effort cleanup. */
          }
        };
        controller.signal.addEventListener('abort', onAbort, { once: true });
        let pending: T | PromiseLike<T>;
        try {
          check();
          pending = start();
        } catch (error) {
          done = true;
          remove();
          reject(error);
          return;
        }
        Promise.resolve(pending).then(
          (value) => {
            if (done) {
              drop(value);
              return;
            }
            try {
              check();
            } catch (error) {
              done = true;
              remove();
              drop(value);
              reject(error);
              return;
            }
            done = true;
            remove();
            resolve(value);
          },
          (error: unknown) => {
            if (done) return;
            done = true;
            remove();
            try {
              check();
              reject(error);
            } catch (stoppedError) {
              reject(stoppedError);
            }
          },
        );
      });
    },
    close() {
      clearTimeout(timer);
      external?.removeEventListener('abort', abort);
      abort();
    },
  };
}

export type SyncPublishBudget = ReturnType<typeof syncPublishBudget>;
