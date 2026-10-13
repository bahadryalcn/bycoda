export const TUNNEL_PROVIDERS = ["ngrok", "cloudflare"] as const;
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
  "connection-failed",
  "startup-timeout",
  "unexpected-exit",
  "process-error",
  "stop-failed",
  "host-restarted",
  "storage-unavailable",
] as const;
export type TunnelIssue = (typeof TUNNEL_ISSUES)[number];
export type TunnelStart = { provider: TunnelProvider; target: TunnelTarget; localUrl?: string };
export type ExternalTunnel = {
  id: string;
  provider: TunnelProvider;
  target: TunnelTarget;
  localUrl: string;
  state: TunnelState;
  publicUrl?: string;
  issue?: TunnelIssue;
  startedAt: number;
  /** Live host ownership, derived for status only; never restored from disk. */
  canStop?: boolean;
};
export type TunnelProviderStatus = {
  provider: TunnelProvider;
  installed: boolean;
  credential: "saved" | "missing" | "unavailable" | "not-required";
};
export type TunnelOverview = {
  environmentId: string;
  hostLocalUrl: string;
  providers: TunnelProviderStatus[];
  tunnels: ExternalTunnel[];
  /** An agent connection/printed URL does not prove external client reachability. */
  publicReachability: "unverified";
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

/** Only credential-free provider URLs are accepted from untrusted CLI output. */
export function tunnelPublicUrl(provider: TunnelProvider, value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 1024) return;
  try {
    const url = new URL(value);
    const suffix =
      provider === "cloudflare"
        ? /^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/
        : /^[a-z0-9-]+\.(?:ngrok-free\.app|ngrok-free\.dev|ngrok\.app|ngrok\.dev|ngrok\.io)$/;
    if (
      url.protocol === "https:" &&
      suffix.test(url.hostname) &&
      !url.port &&
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

export function tunnelActive(state: TunnelState): boolean {
  return state === "starting" || state === "ready" || state === "stopping";
}
