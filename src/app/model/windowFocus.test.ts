import { expect, it, vi } from "vitest";
import { restoreWindowFocus } from "./windowFocus";
it("pencereyi önce geri getirir sonra odaklar", async () => {
  let restore!: () => void;
  const win = {
    unminimize: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          restore = resolve;
        }),
    ),
    show: vi.fn(async () => {}),
    setFocus: vi.fn(async () => {}),
  };
  const pending = restoreWindowFocus(win);
  expect(win.setFocus).not.toHaveBeenCalled();
  restore();
  await pending;
  expect(win.setFocus).toHaveBeenCalledTimes(1);
  expect(win.show).toHaveBeenCalledTimes(1);
  expect(win.show.mock.invocationCallOrder[0]).toBeLessThan(
    win.setFocus.mock.invocationCallOrder[0],
  );
});
