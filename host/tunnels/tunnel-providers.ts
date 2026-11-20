import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import { createConnection } from "node:net";
import { StringDecoder } from "node:string_decoder";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import {
  tunnelPublicUrl,
  type TunnelProvider,
  type TunnelIssue,
} from "../../src/integrations/external-tunnels";

export type TunnelEvent =
  | { type: "ready"; publicUrl: string }
  | { type: "error"; issue: TunnelIssue }
  | { type: "exit" };
export type TunnelCommand = {
  provider: TunnelProvider;
  program: string;
  args: string[];
  token?: string;
};

export async function tunnelExecutable(provider: TunnelProvider): Promise<string | undefined> {
  const name = `${provider === "ngrok" ? "ngrok" : "cloudflared"}${process.platform === "win32" ? ".exe" : ""}`;
  const directories = [
    ...(process.env.PATH ?? "")
      .split(delimiter)
      .map((directory) => directory.replace(/^"|"$/g, "")),
    join(homedir(), ".local", "bin"),
    ...(process.platform === "win32"
      ? [join(homedir(), "scoop", "shims")]
      : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]),
  ];
  for (const directory of new Set(directories.filter(Boolean))) {
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* Next native executable. */
    }
  }
}

export function tunnelCommand(
  provider: TunnelProvider,
  program: string,
  localUrl: string,
  config: string,
  token?: string,
): TunnelCommand {
  return provider === "ngrok"
    ? {
        provider,
        program,
        args: [
          "http",
          localUrl,
          "--config",
          config,
          "--log=stdout",
          "--log-format=json",
          "--inspect=false",
        ],
        token,
      }
    : {
        provider,
        program,
        args: [
          "tunnel",
          "--config",
          config,
          "--no-autoupdate",
          "--http-host-header",
          new URL(localUrl).host,
          "--url",
          localUrl,
        ],
      };
}

export function tunnelEnvironment(command: TunnelCommand): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // No provider's global login/config can silently choose another tunnel.
  for (const key of Object.keys(env)) if (/^(NGROK_|TUNNEL_)/i.test(key)) delete env[key];
  if (command.provider === "ngrok" && command.token) env.NGROK_AUTHTOKEN = command.token;
  return env;
}

export function probeTunnelOrigin(localUrl: string): Promise<boolean> {
  const url = new URL(localUrl);
  return new Promise((resolve) => {
    const socket = createConnection({
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    });
    const finish = (ready: boolean) => {
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(1500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/** How long every provider connection may stay down after ready before the tunnel is retired. */
export const TUNNEL_OUTAGE_MS = 30_000;

const CREDENTIAL_LINE =
  /ERR_NGROK_(4018|105|107)|authentication failed|invalid authtoken|authtoken is required/i;
/** Before ready any of these means the tunnel never came up. */
const STARTUP_FAILURE_LINE =
  /failed to (request|create) quick tunnel|failed to establish session|failed to connect to (ngrok|tunnel)|unable to establish connection with cloudflare edge|unable to reach the origin service|no more connections active|ERR_NGROK_\d+/i;
/** One connection (Cloudflare edge link, ngrok session) is down; the provider retries it. */
const CONNECTION_LOST_LINE =
  /unable to establish connection with cloudflare edge|failed to establish session|failed to connect to (ngrok|tunnel)/i;
/** The provider reports that it has no connection left. */
const ALL_CONNECTIONS_LOST_LINE = /no more connections active/i;

/**
 * Raw logs never leave this parser. Cloudflare's printed URL precedes connection.
 *
 * After ready the tunnel is only retired when it is really gone: credentials rejected, the
 * provider reporting no connection left, or every connection down for `TUNNEL_OUTAGE_MS`.
 * A per-request origin error ("unable to reach the origin service", for example while the Host
 * restarts) or one lost connection among healthy ones is the provider's own retry to handle;
 * tearing the tunnel down would only change the public URL every remote client depends on.
 */
export function tunnelOutput(
  provider: TunnelProvider,
  emit: (event: TunnelEvent) => void,
  now: () => number = monotonicNow,
) {
  let publicUrl: string | undefined;
  let connected = false;
  let ready = false;
  let failure: TunnelIssue | undefined;
  // Connections currently registered with the provider: Cloudflare connIndex values, or the
  // single ngrok session.
  const healthy = new Set<string>();
  let outageSince: number | undefined;
  const fail = (issue: TunnelIssue) => {
    failure = issue;
    emit({ type: "error", issue });
  };
  const publish = () => {
    if (publicUrl && connected && !ready && !failure) {
      ready = true;
      emit({ type: "ready", publicUrl });
    }
  };
  const recovered = (key: string) => {
    healthy.add(key);
    outageSince = undefined;
  };
  const connectionLost = (text: string) => {
    const key = /connIndex=(\d+)/i.exec(text)?.[1] ?? "session";
    healthy.delete(key);
    if (healthy.size > 0) return;
    outageSince ??= now();
    if (elapsedSince(outageSince, now()) >= TUNNEL_OUTAGE_MS) fail("connection-failed");
  };
  const line = (text: string) => {
    if (failure) return;
    if (CREDENTIAL_LINE.test(text)) {
      fail("credential-missing");
      return;
    }
    if (!ready) {
      if (STARTUP_FAILURE_LINE.test(text)) {
        fail("connection-failed");
        return;
      }
    } else if (ALL_CONNECTIONS_LOST_LINE.test(text)) {
      fail("connection-failed");
      return;
    } else if (CONNECTION_LOST_LINE.test(text)) {
      connectionLost(text);
      return;
    } else if (STARTUP_FAILURE_LINE.test(text)) {
      // An isolated origin error or a provider diagnostic: the tunnel itself is still up.
      return;
    }
    if (provider === "ngrok") {
      try {
        const log = JSON.parse(text) as Record<string, unknown>;
        if (log.msg === "started tunnel" || log.msg === "started endpoint") {
          publicUrl = tunnelPublicUrl(provider, log.url ?? log.public_url);
          connected = !!publicUrl;
          if (connected) recovered("session");
        } else if (log.msg === "client session established") recovered("session");
      } catch {
        /* Diagnostics are not candidate URLs. */
      }
    } else {
      for (const value of text.match(/https:\/\/[^\s<>"'|]+/g) ?? []) {
        publicUrl = tunnelPublicUrl(provider, value) ?? publicUrl;
      }
      if (/Registered tunnel connection/i.test(text)) {
        connected = true;
        recovered(/connIndex=(\d+)/i.exec(text)?.[1] ?? "session");
      }
    }
    publish();
  };
  const stream = () => {
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    let dropping = false;
    return {
      write(chunk: Buffer) {
        for (const part of decoder.write(chunk).split(/(?<=\n)/)) {
          if (!dropping) buffer += part;
          if (buffer.length > 16_384) {
            buffer = "";
            dropping = true;
          }
          if (part.endsWith("\n")) {
            if (!dropping) line(buffer.trim());
            buffer = "";
            dropping = false;
          }
        }
      },
      end() {
        if (!dropping) line((buffer + decoder.end()).trim());
        buffer = "";
      },
    };
  };
  return {
    stream,
    get ready() {
      return ready;
    },
    get failure() {
      return failure;
    },
  };
}
