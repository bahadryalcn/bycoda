import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import { CuaDriverClient } from "./cua-driver-client";

/** A fake driver: answers `initialize` itself and hands the test the stdout to write frames to. */
function fakeDriver() {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const proc = Object.assign(new EventEmitter(), {
    stdout,
    stdin,
    exitCode: null as number | null,
    kill() {
      proc.exitCode = 1;
      return true;
    },
  });
  let requests = "";
  stdin.on("data", (data: Buffer) => {
    requests += data.toString("utf8");
    let newline: number;
    while ((newline = requests.indexOf("\n")) >= 0) {
      const message = JSON.parse(requests.slice(0, newline)) as { id?: number; method?: string };
      requests = requests.slice(newline + 1);
      if (message.method === "initialize")
        stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} })}\n`);
    }
  });
  const client = new CuaDriverClient(() => proc as unknown as ChildProcess);
  return { client, proc, stdout };
}

/** Lets the handshake finish and the `tools/call` request register before frames are written. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

it("reassembles one large response split into many small chunks", async () => {
  const { client, stdout } = fakeDriver();
  const call = client.call("driver", "screenshot", {}, { signal: new AbortController().signal });
  await tick();
  const data = "x".repeat(3 * 1024 * 1024);
  const frame = Buffer.from(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "image", data }] } })}\n`,
  );
  for (let offset = 0; offset < frame.length; offset += 16 * 1024)
    stdout.write(frame.subarray(offset, offset + 16 * 1024));
  const result = await call;
  expect(result.content?.[0]?.data).toBe(data);
  client.close();
});

it("handles several frames in one chunk and a multi-byte character split across chunks", async () => {
  const { client, stdout } = fakeDriver();
  const first = client.call("driver", "a", {}, { signal: new AbortController().signal });
  await tick();
  const second = client.call("driver", "b", {}, { signal: new AbortController().signal });
  await tick();
  const one = Buffer.from(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { structuredContent: { text: "€uro" } } })}\n`,
  );
  const two = Buffer.from(
    `${JSON.stringify({ jsonrpc: "2.0", id: 3, result: { isError: true } })}\n`,
  );
  const euro = one.indexOf(0xe2) + 1;
  stdout.write(one.subarray(0, euro));
  stdout.write(Buffer.concat([one.subarray(euro), two]));
  expect((await first).structuredContent).toEqual({ text: "€uro" });
  expect((await second).isError).toBe(true);
  client.close();
});

it("stops the driver when an unfinished line exceeds the limit", async () => {
  const { client, proc, stdout } = fakeDriver();
  const call = client.call("driver", "screenshot", {}, { signal: new AbortController().signal });
  await tick();
  const rejected = expect(call).rejects.toThrow("delivery is unknown");
  const chunk = Buffer.alloc(8 * 1024 * 1024, 0x61);
  for (let i = 0; i < 4; i++) stdout.write(chunk);
  await rejected;
  expect(proc.exitCode).toBe(1);
});
