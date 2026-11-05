import { createHash } from "node:crypto";
import { z } from "zod";
import { DesktopControlOperationSchema } from "../../src/shared/model/host-contracts/desktop-control";

export const DesktopOperationAuditSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  at: z.number().int().nonnegative(),
  principal: z.strictObject({
    kind: z.enum(["owner", "assistant", "chief"]),
    id: z.string().min(1).max(200),
  }),
  app: z.string().min(1).max(200),
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
    "launch",
    "clipboard-get",
    "clipboard-set",
    "clipboard-clear",
  ]),
  headed: z.boolean(),
  operation: DesktopControlOperationSchema.omit({ errorCode: true }),
});
export type DesktopOperationAudit = z.infer<typeof DesktopOperationAuditSchema>;
export function desktopOperationAuditId(
  principal: DesktopOperationAudit["principal"],
  requestId: string,
  state: string,
) {
  return createHash("sha256")
    .update(JSON.stringify([principal.kind, principal.id, requestId, state]))
    .digest("hex");
}
