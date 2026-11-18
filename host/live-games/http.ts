import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { overlayDocument, readOverlayScript } from "./overlay/document";
import type { LiveGamesService } from "./service";

const ROUTE = /^\/live-games\/([a-zA-Z0-9_-]{43})\/(|events|overlay\.js|avatar\/[a-f0-9]{64})$/;

export async function handleLiveGamesHttp(
  service: LiveGamesService,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  const path = (request.url ?? "").split("?", 1)[0];
  if (!path.startsWith("/live-games/")) return false;
  const match = ROUTE.exec(path);
  const loopback = request.socket.remoteAddress === "127.0.0.1" &&
    request.socket.localAddress === "127.0.0.1" &&
    request.headers.host === `127.0.0.1:${request.socket.localPort}`;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  if (!match || request.method !== "GET" || !loopback ||
      request.headers.forwarded || request.headers["x-forwarded-for"] ||
      !timingSafeEqual(Buffer.from(match[1]), Buffer.from(await service.token()))) {
    response.writeHead(404).end();
    return true;
  }

  const resource = match[2];
  if (resource === "events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    });
    let lastActive: boolean | undefined;
    let lastSnapshot: string | undefined;
    let lastSend = 0;
    const unsubscribe = service.subscribe((snapshot, cues, active) => {
      const serialized = JSON.stringify(snapshot);
      const events = [
        active !== lastActive ? `event: active\ndata: ${active}\n\n` : "",
        serialized !== lastSnapshot ? `event: snapshot\ndata: ${serialized}\n\n` : "",
        cues.length ? `event: cue\ndata: ${JSON.stringify(cues)}\n\n` : "",
      ].join("");
      lastActive = active;
      lastSnapshot = serialized;
      const now = Date.now();
      if (events || now - lastSend >= 10_000) {
        lastSend = now;
        if (response.writableLength > 256_000) response.destroy();
        else response.write(events || ": heartbeat\n\n");
      }
    }, () => response.end());
    response.once("close", unsubscribe);
    return true;
  }
  if (resource === "overlay.js") {
    const script = await readOverlayScript().catch(() => undefined);
    if (script) response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }).end(script);
    else response.writeHead(503).end("Build the Host overlay asset and reload.");
    return true;
  }
  if (resource.startsWith("avatar/")) {
    const image = service.avatar(resource.slice("avatar/".length));
    if (image) response.writeHead(200, { "Content-Type": "image/png" }).end(image);
    else response.writeHead(404).end();
    return true;
  }

  const nonce = randomBytes(16).toString("base64");
  response.setHeader("Content-Security-Policy", [
    "default-src 'none'", "script-src 'self'", `style-src 'nonce-${nonce}'`,
    "connect-src 'self'", "img-src 'self'", "frame-ancestors 'none'", "base-uri 'none'",
  ].join("; "));
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(overlayDocument(nonce));
  return true;
}
