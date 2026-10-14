import { expect, it, vi } from "vitest";
import { bootstrap } from "./bootstrap";

it("shows recovery when a startup dependency rejects, without mounting", async () => {
  const error = new Error("App chunk unavailable");
  const mount = vi.fn();
  const recover = vi.fn();
  await bootstrap(() => Promise.reject(error), mount, recover);
  expect(mount).not.toHaveBeenCalled();
  expect(recover).toHaveBeenCalledWith(error);
});

it("can load and mount successfully on a subsequent attempt", async () => {
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ history: [] });
  const mount = vi.fn();
  const recover = vi.fn();
  await bootstrap(load, mount, recover);
  await bootstrap(load, mount, recover);
  expect(recover).toHaveBeenCalledTimes(1);
  expect(mount).toHaveBeenCalledExactlyOnceWith({ history: [] });
});

it("also recovers if mounting throws", async () => {
  const error = new Error("missing root");
  const recover = vi.fn();
  await bootstrap(
    () => Promise.resolve(null),
    () => {
      throw error;
    },
    recover,
  );
  expect(recover).toHaveBeenCalledWith(error);
});
