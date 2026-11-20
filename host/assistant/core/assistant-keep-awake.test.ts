import { afterEach, expect, it, vi } from "vitest";
import { HostAssistantKeepAwake } from "./assistant-keep-awake";

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
