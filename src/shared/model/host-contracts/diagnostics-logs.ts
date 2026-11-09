import { z } from "zod";
import type { HostRpcMethodDefinition } from "./methods";

export const HOST_LOG_SECTION_NAMES = [
  "host",
  "host-previous",
  "host-stdout",
  "host-crash",
  "host-environment",
] as const;

/** Longest section text in characters; the Host reads at most 400 KiB of any file. */
const SECTION_TEXT_MAX = 450_000;

export const DIAGNOSTICS_LOGS_RPC = {
  "diagnostics.logs.read": {
    params: z.strictObject({}),
    result: z.strictObject({
      hostVersion: z.string().min(1).max(64),
      sections: z
        .array(
          z.strictObject({
            name: z.enum(HOST_LOG_SECTION_NAMES),
            text: z.string().max(SECTION_TEXT_MAX),
            truncated: z.boolean(),
          }),
        )
        .max(HOST_LOG_SECTION_NAMES.length),
    }),
  },
} as const;

export type DiagnosticsLogsMethod = keyof typeof DIAGNOSTICS_LOGS_RPC;
export type HostLogReport = z.infer<
  (typeof DIAGNOSTICS_LOGS_RPC)["diagnostics.logs.read"]["result"]
>;

/** The Host's own redacted logs for diagnostic reports; any paired device may read them. */
export function diagnosticsLogsMethods(
  workflow: (
    requiredCapability: string,
    params: z.ZodType,
    result: z.ZodType,
    query?: boolean,
  ) => HostRpcMethodDefinition,
) {
  const schema = DIAGNOSTICS_LOGS_RPC["diagnostics.logs.read"];
  return {
    "diagnostics.logs.read": workflow("diagnostics.logs.v1", schema.params, schema.result, true),
  };
}
