import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HarnessEvent } from "./types";
import { withSlowStartupNotice } from "./providerStartupStatus";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const notices = (events: HarnessEvent[]) =>
  events.flatMap((event) =>
    event.type === "status" && event.key === "provider-starting" ? [event.text] : [],
  );

it("says nothing when the provider starts quickly", async () => {
  const events: HarnessEvent[] = [];
  expect(
    await withSlowStartupNotice(
      (event) => events.push(event),
      "Pi",
      async () => "live",
    ),
  ).toBe("live");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(events).toEqual([]);
});

it("shows the notice during a slow start and clears it once started", async () => {
  const events: HarnessEvent[] = [];
  let finish!: (value: string) => void;
  const started = withSlowStartupNotice(
    (event) => events.push(event),
    "Pi",
    () => new Promise<string>((resolve) => (finish = resolve)),
  );
  await vi.advanceTimersByTimeAsync(5_000);
  expect(notices(events)).toEqual(["Starting Pi…"]);
  finish("live");
  expect(await started).toBe("live");
  expect(notices(events)).toEqual(["Starting Pi…", ""]);
});

it("clears the notice when the start fails", async () => {
  const events: HarnessEvent[] = [];
  let fail!: (error: Error) => void;
  const started = withSlowStartupNotice(
    (event) => events.push(event),
    "OpenCode",
    () => new Promise<string>((_, reject) => (fail = reject)),
  );
  const outcome = started.catch((error: Error) => error.message);
  await vi.advanceTimersByTimeAsync(5_000);
  fail(new Error("no binary"));
  expect(await outcome).toBe("no binary");
  expect(notices(events)).toEqual(["Starting OpenCode…", ""]);
});
