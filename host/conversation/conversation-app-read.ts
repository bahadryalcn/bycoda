import { connect } from "node:net";
import { randomUUID } from "node:crypto";

/** Native desktop fallback when a local session has no host-issued grant. */
export function callConversationAppRead(
  action: string,
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Promise<unknown> {
  if (action !== "sessions.list" && action !== "sessions.read")
    throw new Error("Only session reads may use the desktop fallback.");
  const match = /^(127\.0\.0\.1|\[::1\]):(\d+)$/.exec(env.BYCODA_APP_ENDPOINT ?? "");
  const port = Number(match?.[2]);
  if (!match || port < 1 || port > 65535 || !env.BYCODA_APP_TOKEN)
    throw new Error("Invalid bycoda desktop read connection.");
  const token = env.BYCODA_APP_TOKEN;
  return new Promise((resolve, reject) => {
    const socket = connect({ host: match[1].replace(/[\[\]]/g, ""), port });
    let raw = "";
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error)
        reject(new Error(error.message.replaceAll(token, "[desktop credential redacted]")));
      else resolve(result);
    };
    socket.setEncoding("utf8");
    socket.setTimeout(40000, () => finish(new Error("Desktop session read timed out.")));
    socket.on("connect", () =>
      socket.write(
        JSON.stringify({ token, namespace: "app", action, input, requestId: randomUUID() }) + "\n",
      ),
    );
    socket.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 2 * 1024 * 1024) return finish(new Error("Desktop session read is too large."));
      raw += chunk;
      const newline = raw.indexOf("\n");
      if (newline < 0) return;
      try {
        const value = JSON.parse(raw.slice(0, newline));
        if (value.ok !== true)
          return finish(new Error(value.error ?? "Desktop session read failed."));
        finish(undefined, value.result);
      } catch {
        finish(new Error("Invalid desktop session read response."));
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => finish(new Error("Desktop session read ended without a response.")));
  });
}
