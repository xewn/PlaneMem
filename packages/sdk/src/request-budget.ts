import { ContractError } from '@planemem/contracts';

/** A local waiting budget; stopping it does not prove that a remote operation was canceled. */
export function createRequestBudget(trace: string, timeout: number, external?: AbortSignal) {
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 2_147_483_647 ||
    (external !== undefined &&
      (external === null ||
        typeof external !== 'object' ||
        typeof external.aborted !== 'boolean' ||
        typeof external.addEventListener !== 'function' ||
        typeof external.removeEventListener !== 'function'))
  )
    throw new ContractError('INVALID_INPUT', 'Supply a valid timeout and cancellation signal', {
      trace_id: trace,
    });
  const controller = new AbortController();
  const deadline = performance.now() + timeout;
  const abort = () => controller.abort();
  external?.addEventListener('abort', abort, { once: true });
  if (external?.aborted) abort();
  const timer = setTimeout(abort, timeout);
  const stopped = () =>
    new ContractError(
      external?.aborted ? 'GATEWAY_REQUEST_CANCELED' : 'GATEWAY_REQUEST_TIMEOUT',
      'Stopped waiting for the gateway request; a remote operation may still have completed',
      { trace_id: trace, retryable: false },
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
        let finished = false;
        const remove = () => controller.signal.removeEventListener('abort', onAbort);
        const onAbort = () => {
          if (finished) return;
          finished = true;
          remove();
          reject(stopped());
        };
        const drop = (value: T) => {
          try {
            discard?.(value);
          } catch {
            /* Best-effort cleanup only. */
          }
        };
        controller.signal.addEventListener('abort', onAbort, { once: true });
        let pending: T | PromiseLike<T>;
        try {
          check();
          pending = start();
        } catch (error) {
          finished = true;
          remove();
          reject(error);
          return;
        }
        Promise.resolve(pending).then(
          (value) => {
            if (finished) {
              drop(value);
              return;
            }
            try {
              check();
            } catch (error) {
              finished = true;
              remove();
              drop(value);
              reject(error);
              return;
            }
            finished = true;
            remove();
            resolve(value);
          },
          (error: unknown) => {
            if (finished) return;
            finished = true;
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

export type RequestBudget = ReturnType<typeof createRequestBudget>;
