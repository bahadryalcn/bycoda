import { expect, it } from "vitest";
import { firstRunTourSteps } from "./tourSteps";
import { tourMascotPose } from "./tourMascot";

it("keeps a step's own pose and otherwise greets first, cheers last and points between", () => {
  expect(tourMascotPose("think", 0, true)).toBe("think");
  expect(tourMascotPose(undefined, 0, false)).toBe("wave");
  expect(tourMascotPose(undefined, 3, true)).toBe("cheer");
  expect(tourMascotPose(undefined, 3, false)).toBe("point");
});

it("gives every first-run step a pose, opening with a wave and closing with a cheer", () => {
  const steps = firstRunTourSteps();
  expect(steps.every((step) => step.mascot)).toBe(true);
  expect(steps[0]!.mascot).toBe("wave");
  expect(steps.at(-1)!.mascot).toBe("cheer");
});
