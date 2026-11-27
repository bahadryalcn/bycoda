export const TUNNEL_PROVIDERS = ["ngrok", "cloudflare", "tailscale"] as const;
export type TunnelProvider = (typeof TUNNEL_PROVIDERS)[number];
export type TunnelTarget = "dev-server" | "host";
export type TunnelState = "starting" | "ready" | "stopping" | "stopped" | "error" | "interrupted";
export const TUNNEL_ISSUES = [
  "cli-missing",
  "credential-missing",
  "credential-store-unavailable",
  "invalid-target",
  "host-target-required",
  "origin-unreachable",
  "approval-required",
  "connection-failed",
  "startup-timeout",
  "unexpected-exit",
  "process-error",
  "stop-failed",
  "host-restarted",
  "storage-unavailable",
] as const;
export type TunnelIssue = (typeof TUNNEL_ISSUES)[number];
export type TunnelStart = {
  provider: TunnelProvider;
  target: TunnelTarget;
  localUrl?: string;
  /** Persist opt-in automatic Host access. Only Cloudflare + host accepts this. */
  automatic?: boolean;
};
export type ExternalTunnel = {
  id: string;
  provider: TunnelProvider;
  target: TunnelTarget;
  localUrl: string;
  state: TunnelState;
  publicUrl?: string;
  issue?: TunnelIssue;
  /** With `approval-required`: the validated Tailscale admin page that enables Funnel. */
  approvalUrl?: string;
  startedAt: number;
  /** Live host ownership, derived for status only; never restored from disk. */
  canStop?: boolean;
};
export type TunnelProviderStatus = {
  provider: TunnelProvider;
  installed: boolean;
  credential: "saved" | "missing" | "unavailable" | "not-required";
};
/** The Host quarantined damaged tunnel state and kept what it could salvage. */
export type TunnelRepair = { repaired: true; dropped: number };
export type TunnelOverview = {
  automaticHostAccess?: boolean;
  /** Opt-in: phones may use the public tunnels. Off unless the owner turned it on. */
  phonesOverPublic?: boolean;
  environmentId: string;
  hostLocalUrl: string;
  providers: TunnelProviderStatus[];
  tunnels: ExternalTunnel[];
  /** An agent connection/printed URL does not prove external client reachability. */
  publicReachability: "unverified";
  repair?: TunnelRepair;
};

export class TunnelError extends Error {
  constructor(readonly issue: TunnelIssue) {
    // Fixed codes only: callers must never serialize raw process/vault errors.
    super(issue);
    this.name = "TunnelError";
  }
}

/** The selected host owns loopback. Never resolve an arbitrary network hostname. */
export function tunnelLocalUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 1024 ||
    /\s/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new TunnelError("invalid-target");
  const text = /^\d+$/.test(value) ? `http://127.0.0.1:${value}` : value;
  try {
    const url = new URL(text);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error();
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
    return url.origin;
  } catch {
    throw new TunnelError("invalid-target");
  }
}

/** Ports Tailscale Funnel can listen on, in the order the Host tries them. */
export const FUNNEL_PORTS = [443, 8443, 10000] as const;

/** Only credential-free provider URLs are accepted from untrusted CLI output. */
export function tunnelPublicUrl(provider: TunnelProvider, value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 1024) return;
  try {
    const url = new URL(value);
    const suffix =
      provider === "cloudflare"
        ? /^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/
        : provider === "tailscale"
          ? /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net$/
          : /^[a-z0-9-]+\.(?:ngrok-free\.app|ngrok-free\.dev|ngrok\.app|ngrok\.dev|ngrok\.io)$/;
    const portAllowed =
      provider === "tailscale"
        ? !url.port || FUNNEL_PORTS.some((port) => String(port) === url.port)
        : !url.port;
    if (
      url.protocol === "https:" &&
      suffix.test(url.hostname) &&
      portAllowed &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
    )
      return url.origin;
  } catch {
    /* Never display arbitrary diagnostic links. */
  }
}

/** Process output is untrusted: only the Tailscale admin host may be opened for approval. */
export function tailscaleApprovalUrl(output: string): string | undefined {
  for (const candidate of output.match(/https:\/\/[^\s<>"']+/g) ?? []) {
    try {
      const url = new URL(candidate);
      if (
        url.hostname === "login.tailscale.com" &&
        !url.username &&
        !url.password &&
        url.port === ""
      )
        return url.href;
    } catch {
      /* Untrusted process output is never passed to an external opener. */
    }
  }
  return undefined;
}

export function tunnelActive(state: TunnelState): boolean {
  return state === "starting" || state === "ready" || state === "stopping";
}
