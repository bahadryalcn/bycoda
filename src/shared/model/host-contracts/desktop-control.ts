import { z } from "zod";

export const AGENT_DESKTOP_UPSTREAM_REF = "9eb9b296192fcb70bda25e918cd6dd66abfa3d0d";
export const AGENT_DESKTOP_PROTOCOL = "2.5";
/** These system shortcuts are unavailable even with a physical-input grant. */
export function isForbiddenDesktopShortcut(value: string): boolean {
  const chord = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return /alt.*f4|f4.*alt|(?:win(?:dows)?|meta|super).*l|l.*(?:win(?:dows)?|meta|super)/.test(
    chord,
  );
}
function requestSchema(bounded: boolean) {
  const text = (max: number) => (bounded ? z.string().min(1).max(max) : z.string());
  const plain = (max: number) => (bounded ? z.string().max(max) : z.string());
  const findQuery = z.strictObject({
    role: text(100).optional(),
    name: text(500).optional(),
    text: text(500).optional(),
    exact: z.boolean().optional(),
  });
  return z.discriminatedUnion("op", [
    z.strictObject({ op: z.literal("status") }),
    z.strictObject({
      op: z.literal("configure"),
      expectedVersion: z.number().int().nonnegative(),
      configuration: z.strictObject({
        enabled: z.boolean(),
        binaryPath: plain(4096),
        binarySha256: plain(64),
        allowedApps: z.array(text(200)).max(50),
        allowPhysicalInput: z.boolean(),
      }),
    }),
    z.strictObject({ op: z.literal("snapshot"), app: text(200), windowId: text(200).optional() }),
    z.strictObject({ op: z.literal("windows.list"), app: text(200) }),
    z.strictObject({ op: z.literal("launch"), requestId: text(200), app: text(200) }),
    z.strictObject({
      op: z.literal("clipboard"),
      requestId: text(200),
      action: z.enum(["get", "set", "clear"]),
      text: plain(10000).optional(),
    }),
    z.strictObject({
      op: z.literal("find"),
      app: text(200),
      windowId: text(200),
      query: bounded
        ? findQuery.refine(
            (query) => !!(query.role || query.name || query.text),
            "Choose at least one desktop search filter.",
          )
        : findQuery,
    }),
    z.strictObject({ op: z.literal("screenshot"), app: text(200), windowId: text(200) }),
    z.strictObject({
      op: z.literal("wait"),
      snapshotId: text(100),
      ref: text(200),
      predicate: z.enum(["exists", "visible", "enabled"]),
      timeoutMs: z.number().int().min(1).max(10000),
    }),
    z.strictObject({
      op: z.literal("act"),
      requestId: text(200),
      snapshotId: text(100),
      ref: text(200),
      action: z.enum([
        "click",
        "set-value",
        "clear",
        "type",
        "select",
        "check",
        "uncheck",
        "toggle",
        "expand",
        "collapse",
        "scroll-to",
        "focus",
        "double-click",
        "right-click",
        "press",
      ]),
      text: plain(10000).optional(),
      headed: z.boolean().optional(),
    }),
    z.strictObject({ op: z.literal("stop") }),
    z.strictObject({ op: z.literal("resume") }),
  ]);
}
export const DesktopControlRequestSchema = requestSchema(false);
export const DesktopControlRequestValidationSchema = requestSchema(true);
export type DesktopControlRequest = z.infer<typeof DesktopControlRequestValidationSchema>;
export type DesktopControlConfiguration = {
  enabled: boolean;
  binaryPath: string;
  binarySha256: string;
  allowedApps: string[];
  allowPhysicalInput: boolean;
  version: number;
};
export const DesktopControlConfigurationSchema = z.strictObject({
  enabled: z.boolean(),
  binaryPath: z.string(),
  binarySha256: z.string(),
  allowedApps: z.array(z.string()).max(50),
  allowPhysicalInput: z.boolean(),
  version: z.number().int().nonnegative(),
});
export const DesktopControlOperationSchema = z.strictObject({
  requestId: z.string(),
  state: z.enum(["unknown", "settled"]),
  ok: z.boolean(),
  delivery: z.enum([
    "unknown",
    "not_delivered",
    "delivery_uncertain",
    "delivered_unverified",
    "delivered_verified",
  ]),
  retry: z.enum(["unknown", "safe", "unsafe"]),
  errorCode: z.string().optional(),
});
export type DesktopControlOperation = z.infer<typeof DesktopControlOperationSchema>;
export const DesktopControlResponseSchema = z.strictObject({
  configuration: DesktopControlConfigurationSchema.optional(),
  status: z
    .strictObject({
      installed: z.boolean(),
      verified: z.boolean(),
      enabled: z.boolean(),
      stopped: z.boolean(),
      active: z.boolean(),
      currentAction: z.strictObject({ app: z.string(), action: z.string() }).optional(),
      upstreamRef: z.string(),
      protocol: z.string(),
      message: z.string().optional(),
    })
    .optional(),
  snapshot: z
    .strictObject({
      snapshotId: z.string(),
      app: z.string(),
      windowId: z.string(),
      complete: z.boolean(),
      treeJson: z.string(),
    })
    .optional(),
  windows: z
    .array(
      z.strictObject({
        id: z.string(),
        title: z.string(),
        app: z.string(),
        pid: z.number().int().positive(),
      }),
    )
    .max(200)
    .optional(),
  screenshot: z
    .strictObject({
      app: z.string(),
      windowId: z.string(),
      mimeType: z.literal("image/png"),
      data: z.string(),
      width: z.number().int().positive().max(16384),
      height: z.number().int().positive().max(16384),
    })
    .optional(),
  operation: DesktopControlOperationSchema.optional(),
  clipboard: z.strictObject({ found: z.boolean(), text: z.string().optional() }).optional(),
  dataJson: z.string().optional(),
  ok: z.boolean().optional(),
});
export type DesktopControlResponse = z.infer<typeof DesktopControlResponseSchema>;
