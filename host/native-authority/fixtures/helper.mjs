// Real child-process fixture only. No native pipe, GUI, account or domain authority.
import { appendFileSync } from "node:fs";
const mode = process.argv[2] ?? "normal";
const audit = process.argv[3];
let pending = Buffer.alloc(0);
let bootstrap = true;
let closing = false;
let last = { fixture: true };
let lastId = 0;
let serial = Promise.resolve();
if (mode === "stubborn") setInterval(() => {}, 1000);
const frame = (value) => {
  const bytes = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(bytes.length);
  return Buffer.concat([header, bytes]);
};
const write = (bytes) =>
  new Promise((resolve, reject) =>
    process.stdout.write(bytes, (error) => (error ? reject(error) : resolve())),
  );
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function reply(value) {
  const bytes = frame(value);
  if (mode === "fragmented") {
    for (let index = 0; index < bytes.length; index += 3)
      await write(bytes.subarray(index, index + 3));
  } else await write(bytes);
}
async function handle(value) {
  if (bootstrap) {
    bootstrap = false;
    if (audit && audit !== "-") appendFileSync(audit, JSON.stringify({ bootstrap: value }) + "\n");
    if (mode === "startup-timeout") return;
    if (mode === "startup-error") {
      await reply({ kind: "error", code: "PEER_REJECTED" });
      process.exit(2);
    }
    if (mode === "bad-ready") {
      await reply({ version: 2, kind: "ready" });
      return;
    }
    if (mode === "startup-truncated") {
      await write(Buffer.from([20, 0, 0, 0, 123]));
      process.exit(0);
    }
    await reply({ version: 1, kind: "ready" });
    if (mode === "pause-input") {
      process.stdin.pause();
      setTimeout(() => process.stdin.resume(), 100);
    }
    return;
  }
  if (audit && audit !== "-")
    appendFileSync(audit, JSON.stringify({ kind: value.kind, id: value.id }) + "\n");
  if (!Number.isSafeInteger(value.id) || value.id <= lastId) {
    await reply({ kind: "error", code: "INVALID_COMMAND" });
    process.exit(2);
  }
  lastId = value.id;
  if (mode === "stall" || mode === "stubborn") return;
  if (mode === "truncated") {
    await write(Buffer.from([20, 0, 0, 0, 123]));
    process.exit(0);
  }
  if (mode === "truncated-header") {
    await write(Buffer.from([20, 0]));
    process.exit(0);
  }
  if (mode === "oversize") {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(65537);
    await write(header);
    return;
  }
  if (mode === "bad-utf8") {
    await write(Buffer.from([2, 0, 0, 0, 0xc3, 0x28]));
    return;
  }
  if (mode === "bad-json") {
    await write(Buffer.from([1, 0, 0, 0, 123]));
    return;
  }
  if (mode === "exit-no-reply") process.exit(0);
  if (mode === "native-error") {
    await reply({ kind: "error", id: value.id, code: "PIPE_CLOSED" });
    process.exit(2);
  }
  if (mode === "native-wrapper-too-large") {
    await reply({ kind: "error", id: value.id, code: "FRAME_TOO_LARGE" });
    process.exit(2);
  }
  if (mode === "wrong-id") {
    await reply({ kind: "sent", id: value.id + 1 });
    return;
  }
  if (mode === "wrong-kind") {
    await reply({ kind: "received", id: value.id, value: null });
    return;
  }
  if (mode === "unknown-field") {
    await reply({ kind: "sent", id: value.id, qualified: true });
    return;
  }
  if (mode === "unknown-error") {
    await reply({ kind: "error", id: value.id, code: "ALLOW" });
    return;
  }
  if (mode === "stderr-overflow") {
    process.stderr.write("x".repeat(9000));
    return;
  }
  if (value.kind === "send") {
    last = value.value;
    if (mode === "duplicate") {
      const ack = frame({ kind: "sent", id: value.id });
      await write(Buffer.concat([ack, ack]));
    } else await reply({ kind: "sent", id: value.id });
  } else if (value.kind === "receive") {
    if (mode === "delay-receive") await delay(150);
    await reply({ kind: "received", id: value.id, value: last });
  } else if (value.kind === "close") {
    closing = true;
    await reply({ kind: "closed", id: value.id });
    if (mode === "hold-close") await delay(200);
    process.exit(0);
  }
}
process.stdin.on("data", (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const length = pending.readUInt32LE();
    if (!length || length > 65536) {
      process.exit(2);
      return;
    }
    if (pending.length < 4 + length) return;
    const body = pending.subarray(4, 4 + length);
    pending = pending.subarray(4 + length);
    serial = serial
      .then(() => handle(JSON.parse(body.toString("utf8"))))
      .catch(() => process.exit(2));
  }
});
process.stdin.on("end", () => {
  if (!closing && mode !== "stubborn") process.exit(pending.length ? 2 : 0);
});
