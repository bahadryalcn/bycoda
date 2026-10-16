/** Host-local process birth identity. Never authorize a signal with only a PID. */
export type DevProcessIdentity = { pid: number; startedAt: string };
export type DevProcess = DevProcessIdentity & {
  parentPid?: number;
  name: string;
  command?: string;
  cwd?: string;
};
export type DevServerEndpoint = { address: string; port: number; url: string };
export type DevServerState = "starting" | "running" | "stopping" | "stopped" | "error";
export type DevServer = {
  id: string;
  process?: DevProcess;
  endpoints: DevServerEndpoint[];
  managed: boolean;
  state: DevServerState;
  name: string;
  command?: string;
  cwd?: string;
  projectId?: string;
  projectName?: string;
  association: "managed" | "cwd" | "uncertain";
  logsAvailable: boolean;
  error?: string;
};
export type DevServerScan = {
  status: "ok" | "error";
  servers: DevServer[];
  scannedAt: number;
  error?: string;
};
export type DevServerStart = {
  name: string;
  command: string;
  cwd?: string;
  expectedPort?: number;
};
export type DevServerTarget = { id: string; identity?: DevProcessIdentity; tree?: boolean };
export type DevServerStop = {
  state: "stopped" | "running";
  requiresForce: boolean;
  affectedPorts: number[];
  message?: string;
};
export type DevServerDetails = {
  server: DevServer;
  descendants: DevProcess[];
  affectedPorts: number[];
};
export type DevServerStartResult = {
  server?: DevServer;
  conflict?: { port: number; servers: DevServer[] };
};
