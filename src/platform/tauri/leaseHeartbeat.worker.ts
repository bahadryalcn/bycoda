/** Dedicated-worker clock: unlike main-thread timers it is not throttled with a hidden window. */
let timer: ReturnType<typeof setInterval> | undefined;

self.onmessage = (event: MessageEvent<{ type: "start"; ms: number } | { type: "stop" }>) => {
  clearInterval(timer);
  timer = undefined;
  if (event.data.type === "start") timer = setInterval(() => self.postMessage(0), event.data.ms);
};
