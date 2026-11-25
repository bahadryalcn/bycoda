import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerOptions } from "node:http";
import type { Socket } from "node:net";
import { rejectUpgrade } from "../transport/ws/server-helpers";

/**
 * How a request reached the Host. Every forwarder connects from loopback, so the socket
 * address proves nothing; the Host tells them apart itself:
 * - `tunnel`: the public tunnel ingress listener (Cloudflare, ngrok) accepted the socket;
 * - `mobile`: the Host's own encrypted phone listener forwarded it with the per-boot
 *   ingress secret;
 * - `direct`: anything else on the loopback listener (this computer, or an SSH forward).
 */
export type HostIngress = "direct" | "mobile" | "tunnel";

export const MOBILE_INGRESS_HEADER = "x-bycoda-mobile-ingress";

const tunnelSockets = new WeakSet<Socket>();

/** `invalid`: a request claimed the phone listener without its secret; refuse it. */
export function requestIngress(
  request: IncomingMessage,
  mobileSecret: string | undefined,
): HostIngress | "invalid" {
  if (tunnelSockets.has(request.socket)) return "tunnel";
  const claimed = request.headers[MOBILE_INGRESS_HEADER];
  if (claimed === undefined) return "direct";
  return typeof claimed === "string" &&
    typeof mobileSecret === "string" &&
    Buffer.byteLength(claimed) === Buffer.byteLength(mobileSecret) &&
    timingSafeEqual(Buffer.from(claimed), Buffer.from(mobileSecret))
    ? "mobile"
    : "invalid";
}

/** Whether a request arrived through the public tunnel ingress listener. */
export function isTunnelIngress(request: IncomingMessage): boolean {
  return tunnelSockets.has(request.socket);
}

const PHONE_REFUSAL = JSON.stringify({
  error:
    "Phones connect only over the local network or Tailscale unless public phone access is allowed on the computer.",
});

/**
 * Whether the tunnel ingress refuses a credential: only phone credentials, and only while the
 * owner has not allowed phones over the public internet (read on every request).
 */
export function refusesPhoneOnTunnel(
  phonesAllowed: () => boolean,
  deviceKind: (token: string) => Promise<string | undefined>,
): (token: string) => Promise<boolean> {
  return async (token) => !phonesAllowed() && (await deviceKind(token)) === "phone";
}

/**
 * A second loopback listener that public tunnels forward to. It runs no handler of its
 * own: requests and upgrades go to the main Host server, with the socket recorded as
 * tunnel ingress so authorization can tell it apart from this computer. Phones connect
 * over the local network or Tailscale; over a public tunnel only when the owner allowed it, so
 * a phone credential is refused here before any route runs (every HTTP and WebSocket route takes its credential from
 * `Authorization`), whatever the route.
 */
export function createTunnelIngress(
  main: Server,
  options: ServerOptions,
  isPhoneCredential: (token: string) => Promise<boolean>,
) {
  const server = createServer(options);
  // Accepted upgrades (long-lived sockets) with the credential that opened them.
  const upgraded = new Map<Socket, string>();
  const phone = async (request: IncomingMessage) => {
    const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    // A failed lookup refuses: an unknown answer is not proof the credential is no phone.
    return token ? await isPhoneCredential(token).catch(() => true) : false;
  };
  server.on("connection", (socket) => tunnelSockets.add(socket));
  server.on("request", (request, response) => {
    void phone(request).then(
      (refused) => {
        if (!refused) main.emit("request", request, response);
        else {
          request.resume();
          response
            .writeHead(401, {
              "Content-Type": "application/json",
              "X-Bycoda-Auth-Stage": "before-dispatch",
            })
            .end(PHONE_REFUSAL);
        }
      },
      () => {
        // A handler that threw must not leave the request hanging or become unhandled.
        if (!response.headersSent) response.writeHead(500).end();
        else response.destroy();
      },
    );
  });
  server.on("upgrade", (request, socket: Socket, head: Buffer) => {
    // A reset while the credential is checked must not become an unhandled socket error.
    const ignore = () => socket.destroy();
    socket.on("error", ignore);
    void phone(request).then(
      (refused) => {
        socket.off("error", ignore);
        if (socket.destroyed) return;
        if (!refused) {
          const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
          if (token) {
            upgraded.set(socket, token);
            socket.once("close", () => upgraded.delete(socket));
          }
          main.emit("upgrade", request, socket, head);
        } else rejectUpgrade(socket, 401);
      },
      () => socket.destroy(),
    );
  });
  return {
    /** Listens on a fresh loopback port alongside the Host; the port stays for its lifetime. */
    listen(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
    },
    /**
     * Closes the long-lived sockets whose credential the tunnel now refuses. Called when the owner
     * turns public phone access off: a WebSocket a phone opened while it was allowed must not
     * outlive the setting.
     */
    async closeRefused(): Promise<number> {
      let closed = 0;
      for (const [socket, token] of Array.from(upgraded)) {
        if (!(await isPhoneCredential(token).catch(() => true))) continue;
        upgraded.delete(socket);
        socket.destroy();
        closed++;
      }
      return closed;
    },
    /** The bound port, or undefined while not listening. */
    port(): number | undefined {
      const address = server.address();
      return address && typeof address !== "string" ? address.port : undefined;
    },
    close(): Promise<void> {
      if (!server.listening) return Promise.resolve();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
export type TunnelIngress = ReturnType<typeof createTunnelIngress>;
