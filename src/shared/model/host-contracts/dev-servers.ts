import { z } from "zod";
import { JsonObjectSchema, SafeCounterSchema } from "./schemas";

const port = SafeCounterSchema.min(1).max(65535);
const processFields = {
  // Discovery keeps unidentified listeners as pid=0. The mutation/private-route
  // owners require a positive verified birth identity before any effect.
  pid: SafeCounterSchema,
  startedAt: z.string(),
  parentPid: SafeCounterSchema.optional(),
  command: z.string().optional(),
  cwd: z.string().optional(),
};
export const DevServerProcessSchema = z.strictObject({ ...processFields, name: z.string() });
// Existing callers pass complete discovered process JSON, including extensions.
// This is an explicit open JSON boundary; the owner checks pid + birth time.
export const DevServerIdentitySchema = JsonObjectSchema;
export const DevServerEndpointSchema = z.strictObject({
  address: z.string(),
  port,
  url: z.string(),
});
export const HostDevServerSchema = z.strictObject({
  id: z.string(),
  process: DevServerProcessSchema.optional(),
  endpoints: z.array(DevServerEndpointSchema),
  managed: z.boolean(),
  state: z.enum(["starting", "running", "stopping", "stopped", "error"]),
  name: z.string(),
  command: z.string().optional(),
  cwd: z.string().optional(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  association: z.enum(["managed", "cwd", "uncertain"]),
  logsAvailable: z.boolean(),
  error: z.string().optional(),
});
export const DevServersListResultSchema = z.strictObject({
  status: z.enum(["ok", "error"]),
  servers: z.array(HostDevServerSchema),
  scannedAt: SafeCounterSchema,
  error: z.string().optional(),
});
export const DevServersDetailsResultSchema = z.strictObject({
  expectedImpact: z.string().optional(),
  server: HostDevServerSchema,
  descendants: z.array(DevServerProcessSchema),
  affectedPorts: z.array(port),
});
export const DevServersStartResultSchema = z.strictObject({
  server: HostDevServerSchema.optional(),
  conflict: z.strictObject({ port, servers: z.array(HostDevServerSchema) }).optional(),
});
export const DevServerWorkspaceLeaseSchema = z.strictObject({
  id: z.string(),
  workspaceId: z.string(),
  runId: z.string(),
  ports: z.strictObject({
    vite: port.optional(),
    hmr: port.optional(),
    host: port.optional(),
    cdp: port.optional(),
  }),
});
export const DevServersStartRpcResultSchema = z.union([
  DevServersStartResultSchema,
  z.strictObject({ lease: DevServerWorkspaceLeaseSchema, result: DevServersStartResultSchema }),
]);
export const DevServersStopResultSchema = z.strictObject({
  state: z.enum(["stopped", "running"]),
  requiresForce: z.boolean(),
  affectedPorts: z.array(port),
  message: z.string().optional(),
});
export const DevServersLogsResultSchema = z.strictObject({
  available: z.boolean(),
  output: z.string(),
});
export const DevServersOpenExternalResultSchema = z.strictObject({ url: z.string() });

const project = { projectId: z.string() };
const target = {
  ...project,
  id: z.string(),
  identity: DevServerIdentitySchema.optional(),
  tree: z.boolean().optional(),
  expectedImpact: z.string().optional(),
};
export const DevServersListParamsSchema = z.strictObject({
  ...project,
  refresh: z.boolean().optional(),
});
export const DevServersTargetParamsSchema = z.strictObject(target);
export const DevServersStartParamsSchema = z.strictObject({
  ...project,
  command: z.string(),
  name: z.string().optional(),
  cwd: z.string().optional(),
  expectedPort: port.optional(),
  workspaceId: z.string().optional(),
  runId: z.string().optional(),
});
export const DevServersRestartParamsSchema = DevServersTargetParamsSchema.extend({
  command: z.string().optional(),
  cwd: z.string().optional(),
  name: z.string().optional(),
  expectedPort: port.optional(),
});
export const DevServersOpenExternalParamsSchema = DevServersTargetParamsSchema.extend({
  port,
  address: z.string().optional(),
});
export const DevServersBridgeEndpointParamsSchema = DevServersTargetParamsSchema.extend({
  port,
  address: z.string(),
});
export const DevServersBridgeStreamParamsSchema = z.strictObject({
  ...project,
  streamId: z.string(),
});
export const DEV_SERVER_BRIDGE_CHUNK_BYTES = 256 * 1024;
// Size, encoding and actual decoded-byte bounds belong to DevServerAccess.
const bridgeData = z.string();
export const DevServersBridgeWriteParamsSchema = DevServersBridgeStreamParamsSchema.extend({
  data: bridgeData,
});
export const DevServersBridgeCheckResultSchema = DevServerEndpointSchema.extend({
  connectAddress: z.string(),
});
export const DevServersBridgeOpenResultSchema = z.strictObject({ streamId: z.string() });
export const DevServersBridgeReadResultSchema = z.strictObject({
  data: bridgeData,
  ended: z.boolean(),
  error: z.string().optional(),
});
export const DevServersBridgeWriteResultSchema = z.strictObject({
  written: SafeCounterSchema.max(DEV_SERVER_BRIDGE_CHUNK_BYTES),
});
export const DevServersBridgeCloseResultSchema = z.strictObject({ closed: z.literal(true) });

export type HostDevServer = z.infer<typeof HostDevServerSchema>;
export type DevServersListResult = z.infer<typeof DevServersListResultSchema>;
export type DevServersDetailsResult = z.infer<typeof DevServersDetailsResultSchema>;
export type DevServersStartResult = z.infer<typeof DevServersStartResultSchema>;
export type DevServersStopResult = z.infer<typeof DevServersStopResultSchema>;
export type DevServersLogsResult = z.infer<typeof DevServersLogsResultSchema>;
export type DevServerWorkspaceLease = z.infer<typeof DevServerWorkspaceLeaseSchema>;
export type DevServersBridgeResult = z.infer<
  | typeof DevServersBridgeCheckResultSchema
  | typeof DevServersBridgeOpenResultSchema
  | typeof DevServersBridgeReadResultSchema
  | typeof DevServersBridgeWriteResultSchema
  | typeof DevServersBridgeCloseResultSchema
>;
