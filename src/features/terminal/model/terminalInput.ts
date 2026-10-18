/** Serial, bounded writes. Failed or superseded input is never replayed. */
export function terminalInput(
  write: (data: string) => Promise<void>,
  onFailure: (error: unknown) => void,
  maxPendingBytes = 256 * 1024,
) {
  let tail = Promise.resolve();
  let pendingBytes = 0;
  let epoch = 0;
  let paused = false;
  let disposed = false;
  const pause = (error: unknown) => {
    if (paused || disposed) return;
    paused = true;
    epoch += 1;
    onFailure(error);
  };
  return {
    enqueue(data: string): Promise<boolean> {
      if (paused || disposed) return Promise.resolve(false);
      const bytes = data.length * 2;
      if (pendingBytes + bytes > maxPendingBytes) {
        pause(new Error("Terminal input is backed up."));
        return Promise.resolve(false);
      }
      pendingBytes += bytes;
      const generation = epoch;
      const result = tail.then(async () => {
        if (paused || disposed || generation !== epoch) return false;
        try {
          await write(data);
          return true;
        } catch (error) {
          pause(error);
          return false;
        }
      });
      tail = result.then(() => {
        pendingBytes -= bytes;
      });
      return result;
    },
    resume() {
      if (!disposed) paused = false;
    },
    dispose() {
      disposed = true;
      epoch += 1;
    },
  };
}
