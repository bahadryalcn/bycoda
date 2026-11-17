import { z } from "zod";

const inventory = z.object({
  result: z.object({
    displays: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          type: z.record(z.string(), z.unknown()),
          backlightState: z.string().optional(),
          active: z.boolean().optional(),
        }),
      )
      .max(32),
  }),
});

/** CoreDevice panel power, read per capture; a cached or default panel can be dark after folding. */
export function iosCaptureDisplay(payload: unknown): string {
  const parsed = inventory.safeParse(payload);
  if (!parsed.success)
    throw new Error("DEVICE_DISPLAY_UNAVAILABLE: Xcode did not return a display inventory");
  const panels = parsed.data.result.displays.filter((display) =>
    Object.hasOwn(display.type, "integrated"),
  );
  const lit = panels.filter((display) =>
    display.backlightState === undefined
      ? display.active === true
      : ["activeOn", "inactiveOn", "activeDimmed"].includes(display.backlightState),
  );
  if (lit.length !== 1)
    throw new Error(
      "DEVICE_DISPLAY_UNSETTLED: Wait for the Duo display to settle, then refresh the frame",
    );
  return lit[0].name;
}
