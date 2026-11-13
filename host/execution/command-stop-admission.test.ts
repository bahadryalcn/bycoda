import { afterEach, expect, it } from "vitest";
import { cleanups, setup } from "../engine-support/engine.test-support";

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it("retires the exact accepted run even after its startup admission closes", async () => {
  const { engine, id, provider, waitForTurnStart } = await setup();
  const receipt = await engine.command({
    type: "send",
    commandId: "start-before-revocation",
    sessionId: id,
    text: "Read only.",
  });
  await waitForTurnStart();
  await engine.withCommandAdmission(
    {
      check: async () => {
        throw new Error("Original work admission closed");
      },
    },
    () =>
      engine.command({
        type: "cancel",
        commandId: "retire-original",
        sessionId: id,
        runId: receipt.runId,
      }),
  );
  await engine.waitForRun(id, receipt.runId);
  expect(provider.cancel).toHaveBeenCalledTimes(1);
});
