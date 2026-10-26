import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:net";
import type { PortLeases } from "./workspace-service-contracts.ts";
import type { WorkspacePortKind, WorkspacePortLease } from "./workspace-contracts.ts";

type Request = Parameters<PortLeases["acquire"]>[0];
type HeldLease = { lease: WorkspacePortLease; sockets: Map<WorkspacePortKind, Server> };
const clone = (lease: WorkspacePortLease): WorkspacePortLease => ({
  ...lease,
  ports: { ...lease.ports },
});
const kinds: WorkspacePortKind[] = ["vite", "hmr", "host", "cdp"];

/** Only this service owns its reservation sockets. Handoff never signals a listening process. */
export class DevPortLeases implements PortLeases {
  private readonly held = new Map<string, HeldLease>();

  async acquire(request: Request): Promise<WorkspacePortLease> {
    if (
      !request.workspaceId ||
      !request.runId ||
      !request.kinds.length ||
      request.kinds.some((kind) => !kinds.includes(kind))
    )
      throw new Error("Workspace, run and valid port kinds are required.");
    const held: HeldLease = {
      lease: {
        id: randomUUID(),
        workspaceId: request.workspaceId,
        runId: request.runId,
        ports: {},
      },
      sockets: new Map(),
    };
    // Publish before awaiting so concurrent acquisitions cannot reuse handed-off ports.
    this.held.set(held.lease.id, held);
    try {
      for (const kind of new Set(request.kinds)) {
        const preferred = request.preferred?.[kind];
        if (
          preferred !== undefined &&
          (!Number.isInteger(preferred) || preferred < 1 || preferred > 65535)
        )
          throw new Error("Preferred port must be an integer between 1 and 65535.");
        let socket: Server | undefined;
        for (let attempt = 0; attempt < 32; attempt++) {
          const port = attempt === 0 ? (preferred ?? 0) : 0;
          if (port && this.used(port)) continue;
          try {
            socket = await this.reserve(port);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") continue;
            throw error;
          }
          const selected = socket.address();
          if (!selected || typeof selected === "string")
            throw new Error("Port reservation has no TCP address.");
          if (this.used(selected.port)) {
            await this.close(socket);
            socket = undefined;
            continue;
          }
          held.lease.ports[kind] = selected.port;
          held.sockets.set(kind, socket);
          break;
        }
        if (!socket) throw new Error("Could not reserve a development port.");
      }
      return clone(held.lease);
    } catch (error) {
      await this.release(held.lease.id);
      throw error;
    }
  }

  private used(port: number) {
    return [...this.held.values()].some(({ lease }) => Object.values(lease.ports).includes(port));
  }

  private reserve(port: number): Promise<Server> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => socket.destroy());
      server.once("error", reject);
      // Reserve the exact loopback address handed to Vite/Host/CDP. Windows may
      // permit an IPv4 listener beside an IPv6 wildcard, so never infer dual-stack protection.
      server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
        server.removeListener("error", reject);
        server.unref();
        resolve(server);
      });
    });
  }

  private close(server: Server): Promise<void> {
    return new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  /** A child cannot inherit portable TCP sockets. Unbind only immediately before its launch. */
  async handoff(leaseId: string, selectedKinds?: WorkspacePortKind[]): Promise<void> {
    const held = this.held.get(leaseId);
    if (!held) throw new Error("Unknown development port lease.");
    for (const [kind, socket] of held.sockets) {
      if (selectedKinds && !selectedKinds.includes(kind)) continue;
      held.sockets.delete(kind);
      await this.close(socket);
    }
  }

  async release(leaseId: string): Promise<void> {
    const held = this.held.get(leaseId);
    if (!held) return;
    await this.handoff(leaseId);
    this.held.delete(leaseId);
  }

  async list(workspaceId: string): Promise<WorkspacePortLease[]> {
    return [...this.held.values()]
      .filter(({ lease }) => lease.workspaceId === workspaceId)
      .map(({ lease }) => clone(lease));
  }

  /** The callback must await readiness, and settle its own failed children before throwing. */
  async launchWithRetry<T>(
    request: Request,
    launch: (lease: WorkspacePortLease) => Promise<T>,
    options: { attempts?: number } = {},
  ): Promise<{ lease: WorkspacePortLease; value: T }> {
    const attempts = Math.max(1, Math.min(10, options.attempts ?? 3));
    for (let attempt = 0; ; attempt++) {
      const lease = await this.acquire({
        ...request,
        ...(attempt ? { preferred: undefined } : {}),
      });
      try {
        await this.handoff(lease.id);
        return { lease, value: await launch(lease) };
      } catch (error) {
        await this.release(lease.id);
        if (attempt + 1 >= attempts || !isPortBindRace(error)) throw error;
      }
    }
  }
}

export function isPortBindRace(error: unknown): boolean {
  return (
    (error as NodeJS.ErrnoException | null)?.code === "EADDRINUSE" ||
    /EADDRINUSE|address already in use|port .{0,30}(?:already in use|occupied)/i.test(
      error instanceof Error ? error.message : String(error),
    )
  );
}

export function portLeaseEnvironment(lease: WorkspacePortLease): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [kind, variable] of Object.entries({
    vite: "BYCODA_VITE_PORT",
    hmr: "BYCODA_HMR_PORT",
    host: "BYCODA_DEV_HOST_PORT",
    cdp: "BYCODA_WEBVIEW_DEBUG_PORT",
  })) {
    const port = lease.ports[kind as WorkspacePortKind];
    if (port) env[variable] = String(port);
  }
  if (lease.ports.vite) env.BYCODA_DEV_URL = `http://127.0.0.1:${lease.ports.vite}`;
  return env;
}
