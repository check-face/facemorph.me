/** Files belong to the running work, independently of its slot's latest revision or controller state. */
export function createPhotoTasks() {
  const running = new Set<readonly Blob[]>();
  return {
    files(): readonly Blob[] {
      return [...running].flat();
    },
    run<T>(
      files: readonly Blob[],
      start: () => Promise<T>,
      fulfilled: (value: T) => void,
      rejected: (error: unknown) => void,
    ): Promise<void> {
      const owned = [...files];
      // Register synchronously: start() can dispatch, throw, or begin work before returning its promise.
      running.add(owned);
      let promise: Promise<T>;
      try {
        promise = start();
      } catch (error) {
        promise = Promise.reject(error);
      }
      // Dispatch may synchronously adopt the files into state or start the next photo stage. Keep ownership
      // throughout that handover, including rejection cleanup and stale-result disposal.
      return promise.then(fulfilled, rejected).finally(() => running.delete(owned));
    },
  };
}
