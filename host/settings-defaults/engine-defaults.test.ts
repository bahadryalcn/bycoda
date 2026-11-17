import { afterEach, expect, it } from "vitest";
import { cleanups, setup } from "../engine-support/engine.test-support";
import { HostLimits } from "../limits";

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

it.each([
  [true, undefined, true],
  [false, undefined, false],
  [true, false, false],
] as const)(
  "samples saved resume %s with explicit %s and retains duplicate receipt",
  async (saved, explicit, expected) => {
    const { engine, store, turns, id, waitForTurnStart, provider } = await setup();
    const limits = new HostLimits(store);
    await limits.save({ agentDefaults: { resumeAtReset: saved }, expectedAgentDefaultsVersion: 0 });
    const command = {
      type: "send",
      commandId: "message",
      sessionId: id,
      text: "Work",
      ...(explicit === undefined ? {} : { resumeAtReset: explicit }),
    };
    const receipt = await engine.command(command);
    await waitForTurnStart();
    turns[0].input.onEvent({ type: "usage.limited", resetsAt: 5_000 });
    turns[0].finish();
    await engine.waitForRun(id, receipt.runId);
    expect((await store.session(id)).session.usageLimit?.resumeAtReset).toBe(expected);
    await limits.save({
      agentDefaults: { resumeAtReset: !saved },
      expectedAgentDefaultsVersion: 1,
    });
    expect(await engine.command(command)).toEqual(receipt);
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect((await store.session(id)).session.usageLimit?.resumeAtReset).toBe(expected);
  },
);
