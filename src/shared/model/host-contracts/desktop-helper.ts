import {z} from "zod";

export const DesktopHelperRequestSchema=z.discriminatedUnion("op",[
  z.strictObject({op:z.literal("status")}),
  z.strictObject({op:z.literal("prepare")}),
  z.strictObject({op:z.literal("cancel")}),
]);
export const DesktopHelperResponseSchema=z.strictObject({
  phase:z.enum(["missing","preparing","ready","failed","interrupted"]),
  stage:z.enum(["acquiring","building","verifying","ready"]).optional(),
  error:z.string().optional(),
  helper:z.strictObject({binaryPath:z.string(),binarySha256:z.string(),sourceRef:z.string(),protocol:z.string(),version:z.string(),manifestPath:z.string()}).optional(),
});
export type DesktopHelperRequest=z.infer<typeof DesktopHelperRequestSchema>;
export type DesktopHelperResponse=z.infer<typeof DesktopHelperResponseSchema>;
