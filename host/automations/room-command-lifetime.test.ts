import { expect, it, vi } from "vitest";
import {
  registerRoomCommandHandle,
  RoomToolRetiredError,
  withRoomCommandLifetime,
} from "./room-command-lifetime";

it("retains command physical ownership after inline reply and Abort until exact handle settles", async () => {
  const controller = new AbortController();
  let retire!: (proof: { error?: string }) => void;
  const done = new Promise<{ error?: string }>((resolve) => {
    retire = resolve;
  });
  const cancel = vi.fn();
  const pending = withRoomCommandLifetime(controller.signal, async () => {
    registerRoomCommandHandle({ cancel, done });
    return { status: "running" };
  });
  let settled = false;
  void pending
    .then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    )
    .catch(() => undefined);
  controller.abort();
  expect(cancel).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  expect(settled).toBe(false);
  retire({});
  await expect(pending).resolves.toEqual({ status: "running" });
});

it("unconfirmed process termination cannot become physical retirement proof", async () => {
  await expect(
    withRoomCommandLifetime(new AbortController().signal, async () => {
      registerRoomCommandHandle({
        cancel() {},
        done: Promise.resolve({ error: "Termination was not confirmed." }),
      });
      return {};
    }),
  ).rejects.toThrow("physical retirement is unproven");
});

it("distinguishes observer failure after proven command retirement from an unknown physical owner", async () => {
  await expect(
    withRoomCommandLifetime(new AbortController().signal, async () => {
      registerRoomCommandHandle({ cancel() {}, done: Promise.resolve({}) });
      throw new Error("Owner stopped during reply");
    }),
  ).rejects.toBeInstanceOf(RoomToolRetiredError);
  await expect(
    withRoomCommandLifetime(new AbortController().signal, async () => ({})),
  ).rejects.toThrow("original physical owner is unavailable");
});
