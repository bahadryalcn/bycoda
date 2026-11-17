import { expect, it } from "vitest";
import { iosCaptureDisplay } from "./ios-display";

const panel = (name: string, backlightState: string) => ({
  name,
  backlightState,
  type: { integrated: {} },
});
it.each(["LCD", "LCD-1"])("captures the lit panel %s independent of inventory order", (name) => {
  expect(
    iosCaptureDisplay({
      result: {
        displays: [
          panel("LCD", name === "LCD" ? "activeOn" : "off"),
          panel("LCD-1", name === "LCD-1" ? "activeOn" : "off"),
          { name: "external", backlightState: "activeOn", type: { external: {} } },
        ],
      },
    }),
  ).toBe(name);
});
it("prefers backlight power over the legacy active flag", () => {
  expect(
    iosCaptureDisplay({
      result: {
        displays: [
          { ...panel("LCD", "off"), active: true },
          { ...panel("LCD-1", "activeDimmed"), active: false },
        ],
      },
    }),
  ).toBe("LCD-1");
});
it.for([[], [panel("LCD", "off")], [panel("LCD", "activeOn"), panel("LCD-1", "activeOn")]])(
  "refuses ambiguous power instead of capturing a dark default",
  (displays) => {
    expect(() => iosCaptureDisplay({ result: { displays } })).toThrow("DEVICE_DISPLAY_UNSETTLED");
  },
);
it("rejects malformed inventories", () => {
  expect(() => iosCaptureDisplay(null)).toThrow("DEVICE_DISPLAY_UNAVAILABLE");
});
