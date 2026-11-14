import { z } from "zod";
import { DESKTOP_DRIVERS } from "./desktop-control";

/** `driver` selects which helper to read or prepare; omitted means agent-desktop. */
const driver = z.enum(DESKTOP_DRIVERS).optional();
export const DesktopHelperRequestSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("status"), driver }),
  z.strictObject({ op: z.literal("prepare"), driver }),
  z.strictObject({ op: z.literal("cancel"), driver }),
]);
export const DesktopHelperResponseSchema = z.strictObject({
  phase: z.enum(["missing", "preparing", "ready", "failed", "interrupted"]),
  stage: z.enum(["acquiring", "building", "verifying", "ready"]).optional(),
  error: z.string().optional(),
  helper: z
    .strictObject({
      binaryPath: z.string(),
      binarySha256: z.string(),
      sourceRef: z.string(),
      protocol: z.string(),
      version: z.string(),
      manifestPath: z.string(),
    })
    .optional(),
});
export type DesktopHelperRequest = z.infer<typeof DesktopHelperRequestSchema>;
export type DesktopHelperResponse = z.infer<typeof DesktopHelperResponseSchema>;
