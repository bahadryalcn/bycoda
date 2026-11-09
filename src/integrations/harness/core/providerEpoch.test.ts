import { expect, it } from "vitest";
import { holdProviderEpoch, retireProviderEpochs } from "./providerEpoch";

it("waits for prewarm admission before retiring epochs and preserves replacement tokens", () => {
  const old = {};
  const cancel = new Map([["s", old]]);
  const session = new Map([["s", {}]]);
  const tails = new Map<string, Promise<void>>();
  const release = holdProviderEpoch([cancel, session], "s");
  retireProviderEpochs([cancel, session], tails, "s");
  expect(cancel.get("s")).toBe(old);
  const replacement = {};
  cancel.set("s", replacement);
  release();
  expect(cancel.get("s")).toBe(replacement);
  expect(session.has("s")).toBe(false);
});
