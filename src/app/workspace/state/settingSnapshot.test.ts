import { expect, it } from "vitest";
import { settingSnapshot } from "./settingSnapshot";

it("keeps one parsed snapshot until an event, including changes while unsubscribed", () => {
  let stored = "first",
    reads = 0;
  let change: (() => void) | undefined;
  const setting = settingSnapshot(
    () => {
      reads++;
      return { stored };
    },
    (notify) => {
      change = notify;
      return () => {
        change = undefined;
      };
    },
  );
  const release = setting.subscribe(() => {});
  const first = setting.getSnapshot();
  for (let i = 0; i < 100; i++) expect(setting.getSnapshot()).toBe(first);
  expect(reads).toBe(1);
  stored = "second";
  change!();
  expect(setting.getSnapshot()).toEqual({ stored: "second" });
  expect(reads).toBe(2);
  release();
  stored = "third";
  const stop = setting.subscribe(() => {});
  expect(setting.getSnapshot()).toEqual({ stored: "third" });
  stop();
});
