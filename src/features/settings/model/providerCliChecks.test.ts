import { expect, it } from "vitest";
import { mergeProviderCliChecks } from "./providerCliChecks";
import type { HarnessVersionCheck } from "../../providers/model/harnessUpdates";
it("includes row updates in summary without carrying them across a fresh global check", () => {
  const shared: HarnessVersionCheck[] = [
    { harness: "codex", status: "current", installed: "1.0.0", latest: "1.0.0" },
  ];
  const check: HarnessVersionCheck = {
    harness: "codex",
    status: "behind",
    installed: "1.0.0",
    latest: "2.0.0",
  };
  expect(mergeProviderCliChecks(shared, [{ source: shared, check }])).toEqual([check]);
  expect(mergeProviderCliChecks([...shared], [{ source: shared, check }])).toEqual(shared);
  expect(mergeProviderCliChecks(null, [])).toBeNull();
  expect(mergeProviderCliChecks(null, [{ source: null, check }])).toEqual([check]);
});
