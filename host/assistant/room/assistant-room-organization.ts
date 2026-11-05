import { z } from "zod";

const id = z.string().min(1).max(300);
const page = {
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  memberOffset: z.number().int().nonnegative().optional(),
};
const read = z.strictObject(page);
const patch = z.strictObject({
  requestId: id,
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  change: z.record(z.string(), z.unknown()),
});
const status = z.strictObject({
  requestId: id,
  originalInput: z.record(z.string(), z.unknown()).optional(),
  ...page,
});

/** Parse before a target is captured; never let input choose a cwd or issuer. */
export function validateRoomOrganization(
  action: string,
  input: Record<string, unknown>,
  requestId: string,
) {
  if (action === "projects.organization.read") return read.parse(input);
  if (action === "projects.organization.status") return status.parse(input);
  if (action !== "projects.organization.patch")
    throw new Error("Unsupported Room organization action.");
  const result = patch.parse(input);
  if (result.requestId !== requestId) throw new Error("Organization operation identity changed.");
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 32768)
    throw new Error("Organization operation input is too large.");
  return result;
}
