import { expect, it } from "vitest";
import { HostAssistantKeepAwake } from "./assistant-keep-awake";

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
