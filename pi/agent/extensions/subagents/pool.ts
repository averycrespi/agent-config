export type Release = () => void;

export interface ConcurrencyGate {
  acquire(signal?: AbortSignal): Promise<Release | undefined>;
  setLimit(limit: number): void;
}

type Waiter = {
  signal?: AbortSignal;
  resolve: (release: Release | undefined) => void;
  onAbort?: () => void;
};

function validateLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("concurrency limit must be a positive integer");
  }
}

export function createConcurrencyGate(initialLimit: number): ConcurrencyGate {
  validateLimit(initialLimit);

  let limit = initialLimit;
  let active = 0;
  const waiters: Waiter[] = [];

  function releaseForAdmission(): Release {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= 1;
      drain();
    };
  }

  function drain(): void {
    while (active < limit && waiters.length > 0) {
      const waiter = waiters.shift()!;
      if (waiter.signal?.aborted) {
        waiter.resolve(undefined);
        continue;
      }
      if (waiter.onAbort) {
        waiter.signal?.removeEventListener("abort", waiter.onAbort);
      }
      active += 1;
      waiter.resolve(releaseForAdmission());
    }
  }

  return {
    acquire(signal) {
      if (signal?.aborted) return Promise.resolve(undefined);
      if (active < limit && waiters.length === 0) {
        active += 1;
        return Promise.resolve(releaseForAdmission());
      }

      return new Promise<Release | undefined>((resolve) => {
        const waiter: Waiter = { signal, resolve };
        if (signal) {
          waiter.onAbort = () => {
            const index = waiters.indexOf(waiter);
            if (index === -1) return;
            waiters.splice(index, 1);
            resolve(undefined);
          };
          signal.addEventListener("abort", waiter.onAbort, { once: true });
        }
        waiters.push(waiter);
        drain();
      });
    },

    setLimit(nextLimit) {
      validateLimit(nextLimit);
      limit = nextLimit;
      drain();
    },
  };
}
