/** Abort narration before retiring its runtime and await both output and runtime closure. */
export function retireNarrationOutput(
  abort: AbortController | null,
  playback: Promise<unknown> | null,
  retire: () => Promise<void>,
): Promise<void> {
  abort?.abort();
  return Promise.all([retire(), playback ?? Promise.resolve()]).then(() => undefined);
}
