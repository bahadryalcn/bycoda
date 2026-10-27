import { expect, it } from "vitest";
import { flushDesktopLive, registerDesktopLivePublisher } from "./desktopLiveFlush";

it("rejects missing publishers and does not unregister a newer mounted owner", async () => {
  await expect(flushDesktopLive()).rejects.toThrow("not published");
  let calls = 0;
  const unregisterOld = registerDesktopLivePublisher(async () => {
    throw new Error("old publisher");
  });
  const unregisterCurrent = registerDesktopLivePublisher(async () => {
    calls++;
  });
  unregisterOld();
  await flushDesktopLive();
  expect(calls).toBe(1);
  unregisterCurrent();
  await expect(flushDesktopLive()).rejects.toThrow("not published");
});
