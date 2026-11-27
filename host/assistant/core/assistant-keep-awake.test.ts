import { afterEach, expect, it, vi } from "vitest";
import { HostAssistantKeepAwake, KEEP_AWAKE_RETRY_MS } from "./assistant-keep-awake";

afterEach(() => {
  vi.useRealTimers();
});

/** Fake helper: `exits[i]()` simulates the i-th helper process dying on its own. */
function fakeHelper(options: { failing: () => boolean }) {
  const exits: Array<() => void> = [];
  let acquired = 0;
  return {
    exits,
    get acquired() {
      return acquired;
    },
    acquire: async () => {
      acquired++;
      if (options.failing()) throw new Error("Denied");
      let exit!: () => void;
      const closed = new Promise<void>((done) => (exit = done));
      exits.push(exit);
      return { closed, release: async () => exit() };
    },
  };
}

it("restarts the helper after an unexpected exit while still requested, then clears the error", async () => {
  vi.useFakeTimers();
  const helper = fakeHelper({ failing: () => false });
  const service = new HostAssistantKeepAwake({ platform: "win32", acquire: helper.acquire });
  await service.setEnabled(true);
  helper.exits[0]();
  await vi.advanceTimersByTimeAsync(0);
  expect(service.status).toMatchObject({ requested: true, active: false });
  expect(service.status.error).toBe("The system-awake helper stopped.");
  await vi.advanceTimersByTimeAsync(1000);
  expect(helper.acquired).toBe(2);
  expect(service.status).toMatchObject({ requested: true, active: true });
  expect(service.status.error).toBeUndefined();
  await service.close();
});

it("bounds restart attempts after repeated failures and does not spawn duplicate helpers", async () => {
  vi.useFakeTimers();
  let failing = false;
  const helper = fakeHelper({ failing: () => failing });
  const service = new HostAssistantKeepAwake({ platform: "win32", acquire: helper.acquire });
  await service.setEnabled(true);
  failing = true;
  helper.exits[0]();
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
  // 1 initial acquire + 5 scheduled restart attempts, then the budget is spent.
  expect(helper.acquired).toBe(6);
  expect(service.status).toMatchObject({ requested: true, active: false });
  expect(service.status.error).toBe("The system-awake helper could not be restarted.");
  await service.close();
});

it("an explicit stop cancels a pending restart", async () => {
  vi.useFakeTimers();
  const helper = fakeHelper({ failing: () => false });
  const service = new HostAssistantKeepAwake({ platform: "win32", acquire: helper.acquire });
  await service.setEnabled(true);
  helper.exits[0]();
  await vi.advanceTimersByTimeAsync(0);
  await service.setEnabled(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(helper.acquired).toBe(1);
  expect(service.status).toMatchObject({ requested: false, active: false });
  expect(service.status.error).toBeUndefined();
  await service.close();
});

it("is opt-in, reuses one power request, and releases when work ends or Host closes", async () => {
  let acquired = 0,
    released = 0;
  const service = new HostAssistantKeepAwake({
    platform: "win32",
    acquire: async () => {
      acquired++;
      return {
        release: async () => {
          released++;
        },
      };
    },
  });
  expect(service.status.active).toBe(false);
  await service.setEnabled(true);
  await service.setEnabled(true);
  expect(acquired).toBe(1);
  expect(service.status.active).toBe(true);
  await service.setEnabled(false);
  expect(released).toBe(1);
  expect(service.status.active).toBe(false);
  await service.setEnabled(true);
  await service.close();
  expect(released).toBe(2);
  expect(service.status.requested).toBe(false);
});
it("releases a delayed acquisition when the owner disables it before acknowledgement", async () => {
  let resolve!: (handle: { release(): Promise<void> }) => void;
  let release = 0;
  const service = new HostAssistantKeepAwake({
    platform: "win32",
    acquire: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const pending = service.setEnabled(true);
  await Promise.resolve();
  const disabling = service.setEnabled(false);
  resolve({
    release: async () => {
      release++;
    },
  });
  await pending;
  await disabling;
  expect(service.status.active).toBe(false);
  expect(release).toBe(1);
  await service.close();
});
it("answers demand before the helper acknowledges, without claiming it is active", async () => {
  let acknowledge!: (handle: { release(): Promise<void> }) => void;
  const onChange = vi.fn();
  const service = new HostAssistantKeepAwake({
    platform: "win32",
    onChange,
    acquire: () =>
      new Promise((done) => {
        acknowledge = done;
      }),
  });
  expect(service.sync(true)).toMatchObject({ requested: true, active: false });
  await vi.waitFor(() => expect(acknowledge).toBeTypeOf("function"));
  acknowledge({ release: async () => {} });
  await vi.waitFor(() => expect(service.status.active).toBe(true));
  expect(onChange).toHaveBeenCalled();
  await service.close();
});

it("shares one attempt across repeated demand and retries a failure only after the cooldown", async () => {
  vi.useFakeTimers();
  const helper = fakeHelper({ failing: () => true });
  const service = new HostAssistantKeepAwake({ platform: "win32", acquire: helper.acquire });
  service.sync(true);
  service.sync(true);
  await vi.advanceTimersByTimeAsync(0);
  service.sync(true);
  await vi.advanceTimersByTimeAsync(KEEP_AWAKE_RETRY_MS - 1);
  service.sync(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(helper.acquired).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  service.sync(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(helper.acquired).toBe(2);
  await service.close();
});

it("keeps the restart budget and pending restart across repeated demand", async () => {
  vi.useFakeTimers();
  const helper = fakeHelper({ failing: () => false });
  const service = new HostAssistantKeepAwake({ platform: "win32", acquire: helper.acquire });
  service.sync(true);
  await vi.advanceTimersByTimeAsync(0);
  helper.exits[0]();
  await vi.advanceTimersByTimeAsync(0);
  service.sync(true);
  await vi.advanceTimersByTimeAsync(999);
  expect(helper.acquired).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(helper.acquired).toBe(2);
  await service.close();
});

it("stops an unacknowledged helper as soon as demand ends or Host closes", async () => {
  const signals: AbortSignal[] = [];
  const acquire = (signal?: AbortSignal) =>
    new Promise<never>((_, reject) => {
      signals.push(signal!);
      signal!.addEventListener("abort", () => reject(new Error("Stopped")), { once: true });
    });
  const service = new HostAssistantKeepAwake({ platform: "win32", acquire });
  service.sync(true);
  await vi.waitFor(() => expect(signals).toHaveLength(1));
  service.sync(false);
  await vi.waitFor(() => expect(signals[0].aborted).toBe(true));
  service.sync(true);
  await vi.waitFor(() => expect(signals).toHaveLength(2));
  await service.close();
  expect(signals[1].aborted).toBe(true);
  expect(service.status).toMatchObject({ requested: false, active: false });
});

it("does not claim unsupported platforms or failed power requests are active", async () => {
  let acquired = 0;
  const unsupported = new HostAssistantKeepAwake({
    platform: "darwin",
    acquire: async () => {
      acquired++;
      return { release: async () => {} };
    },
  });
  await unsupported.setEnabled(true);
  expect(unsupported.status).toMatchObject({ supported: false, active: false });
  expect(acquired).toBe(0);
  await unsupported.close();
  const failing = new HostAssistantKeepAwake({
    platform: "win32",
    acquire: async () => {
      throw new Error("Denied");
    },
  });
  await failing.setEnabled(true);
  expect(failing.status).toMatchObject({ supported: true, active: false, error: "Denied" });
  await failing.close();
});
