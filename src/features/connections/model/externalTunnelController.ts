import {
  TUNNEL_PROVIDERS,
  TUNNEL_ISSUES,
  TunnelError,
  tunnelLocalUrl,
  tunnelPublicUrl,
  type TunnelIssue,
  type TunnelOverview,
  type ExternalTunnel,
  type TunnelStart,
} from "../../../integrations/external-tunnels";
import { remoteRequest } from "./connections";
import type { RemoteMachine } from "./protocol";

export type TunnelUiIssue = TunnelIssue | "host-update" | "connection" | "invalid-response";
export type TunnelPanelState = {
  phase: "loading" | "ready" | "error";
  overview?: TunnelOverview;
  pending: boolean;
  issue?: TunnelUiIssue;
};
export type TunnelApi = {
  status: (fresh?: boolean) => Promise<unknown>;
  start: (input: TunnelStart) => Promise<unknown>;
  stop: (id: string) => Promise<unknown>;
  credential: (token: string) => Promise<unknown>;
};

export function externalTunnelApi(machine: RemoteMachine): TunnelApi {
  return {
    status: (fresh = false) => remoteRequest(machine.id, "tunnels.status", {}, fresh, fresh),
    start: (input) => remoteRequest(machine.id, "tunnels.start", input, false, true),
    stop: (id) => remoteRequest(machine.id, "tunnels.stop", { id }, false, true),
    credential: (token) =>
      remoteRequest(machine.id, "tunnels.credential", { provider: "ngrok", token }, false, true),
  };
}

function invalid(): never {
  throw new Error("invalid-response");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

/** Reconstruct the public contract: even an RPC error must not expose CLI secrets. */
export function readTunnelOverview(value: unknown, environmentId: string): TunnelOverview {
  const overview = object(value);
  if (
    overview.environmentId !== environmentId ||
    overview.publicReachability !== "unverified" ||
    !Array.isArray(overview.tunnels) ||
    overview.tunnels.length > 32 ||
    !Array.isArray(overview.providers) ||
    overview.providers.length !== 2
  )
    invalid();
  let hostLocalUrl: string;
  try {
    hostLocalUrl = tunnelLocalUrl(overview.hostLocalUrl);
  } catch {
    invalid();
  }
  const providers = TUNNEL_PROVIDERS.map((provider) => {
    const matches = (overview.providers as unknown[])
      .map(object)
      .filter((item) => item.provider === provider);
    if (matches.length !== 1) invalid();
    const entry = matches[0];
    if (
      typeof entry.installed !== "boolean" ||
      !(
        provider === "cloudflare" ? ["not-required"] : ["saved", "missing", "unavailable"]
      ).includes(String(entry.credential))
    )
      invalid();
    return {
      provider,
      installed: entry.installed,
      credential: entry.credential as TunnelOverview["providers"][number]["credential"],
    };
  });
  const ids = new Set<string>();
  const tunnels = overview.tunnels.map((value) => {
    const item = object(value);
    if (
      typeof item.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(item.id) ||
      ids.has(item.id) ||
      !TUNNEL_PROVIDERS.includes(item.provider as never) ||
      !["host", "dev-server"].includes(String(item.target)) ||
      !["starting", "ready", "stopping", "stopped", "error", "interrupted"].includes(
        String(item.state),
      ) ||
      typeof item.startedAt !== "number" ||
      !Number.isFinite(item.startedAt) ||
      typeof item.canStop !== "boolean" ||
      (item.issue !== undefined && !TUNNEL_ISSUES.includes(item.issue as never))
    )
      invalid();
    ids.add(item.id);
    const provider = item.provider as ExternalTunnel["provider"];
    const publicUrl = tunnelPublicUrl(provider, item.publicUrl);
    if (item.state === "ready" && !publicUrl) invalid();
    let localUrl: string;
    try {
      localUrl = tunnelLocalUrl(item.localUrl);
    } catch {
      invalid();
    }
    return {
      id: item.id,
      provider,
      target: item.target as ExternalTunnel["target"],
      state: item.state as ExternalTunnel["state"],
      localUrl,
      startedAt: item.startedAt,
      canStop: item.canStop,
      ...(item.state === "ready" ? { publicUrl } : {}),
      ...(item.issue ? { issue: item.issue as TunnelIssue } : {}),
    };
  });
  return { environmentId, hostLocalUrl, providers, tunnels, publicReachability: "unverified" };
}

export function tunnelUiIssue(error: unknown): TunnelUiIssue {
  if (error instanceof TunnelError) return error.issue;
  const text = String(error).replace(/^Error: /, "");
  if (TUNNEL_ISSUES.includes(text as TunnelIssue)) return text as TunnelIssue;
  if (text === "invalid-response") return "invalid-response";
  if (
    /unknown (?:host )?method|unsupported (?:host |remote )?(?:method|operation)|not supported|update bycoda host/i.test(
      text,
    )
  )
    return "host-update";
  return "connection";
}

/** One selected machine per instance. Mutations invalidate all prior status reads. */
export class ExternalTunnelController {
  private state: TunnelPanelState = { phase: "loading", pending: false };
  private generation = 0;
  private closed = false;
  private reading?: Promise<void>;
  private listeners = new Set<() => void>();
  constructor(
    private readonly environmentId: string,
    private readonly api: TunnelApi,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(state: TunnelPanelState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  close = () => {
    this.closed = true;
    this.generation++;
    this.reading = undefined;
  };
  activate = () => {
    this.closed = false;
  };

  refresh = (fresh = false): Promise<void> => {
    if (this.closed || this.state.pending) return Promise.resolve();
    if (this.reading) return this.reading;
    const generation = this.generation;
    const work = (async () => {
      try {
        const value = await this.api.status(fresh);
        if (this.closed || generation !== this.generation) return;
        this.publish({
          phase: "ready",
          pending: false,
          overview: readTunnelOverview(value, this.environmentId),
        });
      } catch (error) {
        if (!this.closed && generation === this.generation)
          this.publish({
            ...this.state,
            phase: "error",
            pending: false,
            issue: tunnelUiIssue(error),
          });
      }
    })();
    this.reading = work;
    void work.finally(() => {
      if (this.reading === work) this.reading = undefined;
    });
    return work;
  };

  private async mutate(work: () => Promise<unknown>): Promise<void> {
    if (this.closed || this.state.pending) return;
    const generation = ++this.generation;
    this.publish({ ...this.state, pending: true, issue: undefined });
    try {
      await work();
      if (this.closed || generation !== this.generation) return;
      const overview = readTunnelOverview(await this.api.status(true), this.environmentId);
      if (this.closed || generation !== this.generation) return;
      this.publish({ phase: "ready", pending: false, overview });
    } catch (error) {
      if (!this.closed && generation === this.generation)
        this.publish({
          ...this.state,
          phase: "error",
          pending: false,
          issue: tunnelUiIssue(error),
        });
    }
  }
  start = (input: TunnelStart) =>
    this.mutate(() =>
      this.api.start({
        ...input,
        ...(input.target === "dev-server" ? { localUrl: tunnelLocalUrl(input.localUrl) } : {}),
      }),
    );
  stop = (id: string) => this.mutate(() => this.api.stop(id));
  credential = (token: string) => this.mutate(() => this.api.credential(token));
}
