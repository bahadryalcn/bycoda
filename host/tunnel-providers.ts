import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import { createConnection } from "node:net";
import { StringDecoder } from "node:string_decoder";
import {
  tunnelPublicUrl,
  type TunnelProvider,
  type TunnelIssue,
} from "../src/integrations/external-tunnels";

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
    ...(process.env.PATH ?? "").split(delimiter),
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
        args: ["tunnel", "--config", config, "--no-autoupdate", "--url", localUrl],
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

/** Raw logs never leave this parser. Cloudflare's printed URL precedes connection. */
export function tunnelOutput(provider: TunnelProvider, emit: (event: TunnelEvent) => void) {
  let publicUrl: string | undefined;
  let connected = false;
  let ready = false;
  let failure: TunnelIssue | undefined;
  const publish = () => {
    if (publicUrl && connected && !ready && !failure) {
      ready = true;
      emit({ type: "ready", publicUrl });
    }
  };
  const line = (text: string) => {
    if (failure) return;
    if (
      /ERR_NGROK_(4018|105|107)|authentication failed|invalid authtoken|authtoken is required/i.test(
        text,
      )
    ) {
      failure = "credential-missing";
      emit({ type: "error", issue: failure });
      return;
    }
    if (
      /failed to (request|create) quick tunnel|failed to establish session|failed to connect to (ngrok|tunnel)|unable to establish connection with cloudflare edge|unable to reach the origin service|no more connections active|ERR_NGROK_\d+/i.test(
        text,
      )
    ) {
      failure = "connection-failed";
      emit({ type: "error", issue: failure });
      return;
    }
    if (provider === "ngrok") {
      try {
        const log = JSON.parse(text) as Record<string, unknown>;
        if (log.msg === "started tunnel" || log.msg === "started endpoint") {
          publicUrl = tunnelPublicUrl(provider, log.url ?? log.public_url);
          connected = !!publicUrl;
        }
      } catch {
        /* Diagnostics are not candidate URLs. */
      }
    } else {
      for (const value of text.match(/https:\/\/[^\s<>"'|]+/g) ?? []) {
        publicUrl = tunnelPublicUrl(provider, value) ?? publicUrl;
      }
      if (/Registered tunnel connection/i.test(text)) connected = true;
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
