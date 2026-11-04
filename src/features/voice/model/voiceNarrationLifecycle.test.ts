import { expect, it, vi } from "vitest";
import { retireNarrationOutput } from "./voiceNarrationLifecycle";

it("aborts active output and waits for its settlement before privacy retirement", async () => {
  const abort = new AbortController();
  let finish!: () => void;
  const playback = new Promise<void>(resolve => { finish = resolve; });
  const onAbort = vi.fn();
  abort.signal.addEventListener("abort", onAbort);
  let retired = false;
  const closing = retireNarrationOutput(abort, playback, async () => {}).then(() => { retired = true; });
  expect(onAbort).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(retired).toBe(false);
  finish();
  await closing;
  expect(retired).toBe(true);
  expect(abort.signal.aborted).toBe(true);
});
