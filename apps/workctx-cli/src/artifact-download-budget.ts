import { ContractError } from '@planemem/contracts';

/** Read-only budget. Close it before awaiting local publication to avoid uncertain writes. */
export function artifactDownloadBudget(timeout: number, trace: string) {
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647)
    throw new ContractError('INVALID_INPUT', 'Supply a valid download timeout', {
      trace_id: trace,
    });
  const controller = new AbortController();
  const deadline = performance.now() + timeout;
  const timer = setTimeout(() => controller.abort(), timeout);
  const stopped = () =>
    new ContractError(
      'GATEWAY_REQUEST_TIMEOUT',
      'Artifact download reads exceeded the local deadline; no local save was started',
      { trace_id: trace, retryable: false },
    );
  const check = () => {
    if (controller.signal.aborted || performance.now() >= deadline) {
      controller.abort();
      throw stopped();
    }
  };
  return {
    signal: controller.signal,
    check,
    wait<T>(start: () => Promise<T>): Promise<T> {
      check();
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const remove = () => controller.signal.removeEventListener('abort', abort);
        const abort = () => {
          if (settled) return;
          settled = true;
          remove();
          reject(stopped());
        };
        controller.signal.addEventListener('abort', abort, { once: true });
        let pending: Promise<T>;
        try {
          check();
          pending = start();
        } catch (error) {
          settled = true;
          remove();
          reject(error);
          return;
        }
        pending.then(
          (value) => {
            if (settled) return;
            try {
              check();
              settled = true;
              remove();
              resolve(value);
            } catch (error) {
              settled = true;
              remove();
              reject(error);
            }
          },
          (error: unknown) => {
            if (settled) return;
            try {
              check();
            } catch (expired) {
              error = expired;
            }
            settled = true;
            remove();
            reject(error);
          },
        );
      });
    },
    close() {
      clearTimeout(timer);
      controller.abort();
    },
  };
}
