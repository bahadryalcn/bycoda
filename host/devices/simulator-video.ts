import { Buffer } from "node:buffer";

const START = Buffer.from([0, 0, 0, 1]);
const MAX_PACKET = 8 * 1024 * 1024;

/** Converts the pinned simulator helper's length-prefixed AVCC records into complete Annex-B pictures. */
export class SimulatorPictures {
  private readonly header = Buffer.alloc(4);
  private headerUsed = 0;
  private body?: Buffer;
  private used = 0;
  private nalLength = 0;
  private parameters?: Buffer;
  private needsParameters = true;

  push(bytes: Buffer, picture: (bytes: Buffer) => void) {
    let offset = 0;
    while (offset < bytes.length) {
      if (!this.body) {
        const count = bytes.copy(
          this.header,
          this.headerUsed,
          offset,
          offset + 4 - this.headerUsed,
        );
        offset += count;
        this.headerUsed += count;
        if (this.headerUsed < 4) return;
        const size = this.header.readUInt32BE();
        if (!size || size > MAX_PACKET) throw new Error("Invalid simulator video packet size");
        this.body = Buffer.allocUnsafe(size);
        this.used = this.headerUsed = 0;
      }
      const count = bytes.copy(this.body, this.used, offset, offset + this.body.length - this.used);
      offset += count;
      this.used += count;
      if (this.used === this.body.length) {
        this.record(this.body[0], this.body.subarray(1), picture);
        this.body = undefined;
      }
    }
  }

  private record(tag: number, data: Buffer, picture: (bytes: Buffer) => void) {
    if (tag === 1) {
      if (data.length < 7 || data[0] !== 1) throw new Error("Invalid simulator AVC description");
      this.nalLength = 1 + (data[4] & 3);
      let offset = 6;
      const parameters: Buffer[] = [];
      const readSets = (count: number) => {
        if (!count) throw new Error("Missing simulator AVC parameter set");
        for (let i = 0; i < count; i++) {
          const length = data.readUInt16BE(offset);
          offset += 2;
          if (!length || offset + length > data.length)
            throw new Error("Invalid simulator AVC parameter set");
          parameters.push(START, data.subarray(offset, offset + length));
          offset += length;
        }
      };
      readSets(data[5] & 31);
      readSets(data.readUInt8(offset++));
      const next = Buffer.concat(parameters);
      if (!this.parameters?.equals(next)) {
        this.parameters = next;
        this.needsParameters = true;
      }
    } else if ((tag === 2 || tag === 3) && this.parameters) {
      if (!data.length || (this.needsParameters && tag !== 2)) return;
      // The GOP buffer supplies parameters to new readers. Inserting them on every
      // IDR would move its retained cursor past a viewer already caught up.
      const parts = this.needsParameters ? [this.parameters] : [];
      for (let offset = 0; offset < data.length;) {
        if (parts.length > 8192) throw new Error("Too many simulator AVC slices");
        const length = data.readUIntBE(offset, this.nalLength);
        offset += this.nalLength;
        if (!length || length > data.length - offset)
          throw new Error("Invalid simulator AVC picture");
        parts.push(START, data.subarray(offset, offset + length));
        offset += length;
      }
      this.needsParameters = false;
      picture(Buffer.concat(parts));
    } else if (tag === 7) throw new Error("Simulator video ended");
  }
}

/** The hub stays on the device Host's loopback. Its URL and credentials never leave the Host. */
export async function readSimulatorVideo(
  origin: string,
  id: string,
  signal: AbortSignal,
  publish: (bytes: Buffer, display: { width: number; height: number }) => void,
) {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error("Invalid simulator identifier");
  const base = origin + "/vendor/serve-sim/helper/" + encodeURIComponent(id);
  const options = { signal, redirect: "error" as const };
  const response = await fetch(base + "/stream.avcc", options);
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get("content-type")?.includes("application/octet-stream")
  )
    throw new Error("Simulator video unavailable");
  const reader = response.body.getReader();
  const pictures = new SimulatorPictures();
  let display: { width: number; height: number } | undefined;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Simulator video ended");
      const batch: Buffer[] = [];
      pictures.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength), (bytes) =>
        batch.push(bytes),
      );
      if (!batch.length) continue;
      if (!display) {
        const config = await fetch(base + "/config", {
          ...options,
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        });
        if (!config.ok) throw new Error("Simulator display unavailable");
        const { width, height } = (await config.json()) as { width: number; height: number };
        if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 20000))
          throw new Error("Invalid simulator display dimensions");
        display = { width, height };
      }
      for (const bytes of batch) publish(bytes, display);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
