import { expect, it } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { applyHarnessEvent } from "./apply";

it("updates both active and selected targets when the provider changes its current model", () => {
  const original = {
    ...newSession("pi", "/repo"),
    busy: true,
    model: "pi:provider/old",
    modelSettings: {},
    runningModelTarget: { harness: "pi" as const, model: "pi:provider/old", modelSettings: {} },
  };
  const result = applyHarnessEvent(original, {
    type: "session.configChanged",
    model: "pi:provider/fallback",
  });
  expect(result.model).toBe("pi:provider/fallback");
  expect(result.runningModelTarget?.model).toBe("pi:provider/fallback");
});
