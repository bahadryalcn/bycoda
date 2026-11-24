import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { readSimulatorVideo, SimulatorPictures } from "./simulator-video";

function record(tag: number, data: number[]) {
  const header = Buffer.alloc(5);
  header.writeUInt32BE(1 + data.length);
  header[4] = tag;
  return Buffer.concat([header, Buffer.from(data)]);
}

const description = record(1, [1, 66, 0, 30, 255, 225, 0, 4, 103, 66, 0, 30, 1, 0, 2, 104, 206]);
const key = record(2, [0, 0, 0, 2, 101, 128]);
const delta = record(3, [0, 0, 0, 2, 65, 128]);
const pictures = [
  Buffer.from([0, 0, 0, 1, 103, 66, 0, 30, 0, 0, 0, 1, 104, 206, 0, 0, 0, 1, 101, 128]),
  Buffer.from([0, 0, 0, 1, 65, 128]),
];

it("retains partial headers and slices, skips the JPEG seed, and supplies codec parameters at keyframes", () => {
  const parser = new SimulatorPictures();
  const frames: Buffer[] = [];
  const packet = Buffer.concat([record(4, [255, 216]), description, key, delta, description, key]);
  for (const byte of packet) parser.push(Buffer.from([byte]), (picture) => frames.push(picture));
  expect(frames).toEqual([...pictures, Buffer.from([0, 0, 0, 1, 101, 128])]);
});

it("rejects oversized packets and truncated NAL payloads", () => {
  const parser = new SimulatorPictures();
  expect(() => parser.push(Buffer.from([127, 255, 255, 255]), () => {})).toThrow("packet size");
  const malformed = Buffer.concat([description, record(2, [0, 0, 0, 3, 101])]);
  expect(() => new SimulatorPictures().push(malformed, () => {})).toThrow("AVC picture");
});

it("reads the private simulator feed over HTTP and cancels the open body on stop", async () => {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url!);
    if (req.url?.endsWith("/config")) {
      res.end(JSON.stringify({ width: 390, height: 844 }));
    } else {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.write(Buffer.concat([description, key, delta]));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const controller = new AbortController();
  const seen: Buffer[] = [];
  try {
    const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
    await expect(
      readSimulatorVideo(origin, "sim-1", controller.signal, (bytes, display) => {
        expect(display).toEqual({ width: 390, height: 844 });
        seen.push(bytes);
        if (seen.length === 2) controller.abort();
      }),
    ).rejects.toThrow();
    expect(paths).toEqual([
      "/vendor/serve-sim/helper/sim-1/stream.avcc",
      "/vendor/serve-sim/helper/sim-1/config",
    ]);
    expect(seen).toEqual(pictures);
  } finally {
    controller.abort();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
