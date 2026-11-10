import { expect, it } from "vitest";
import { readAlwaysOn } from "./assistant-always-on";

it("counts phones and those with Assistant updates on", async () => {
  expect(
    await readAlwaysOn(async () => [
      { events: { assistant: true } },
      { events: { assistant: false } },
    ]),
  ).toEqual({ pushPhones: 2, assistantPushPhones: 1 });
  expect(await readAlwaysOn(undefined)).toEqual({ pushPhones: 0, assistantPushPhones: 0 });
});
