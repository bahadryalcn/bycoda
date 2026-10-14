import { randomUUID } from "node:crypto";
import { createConnection, isIP, type Socket } from "node:net";
import type { DevServerDetails } from "../src/features/host-tools/devServerTypes";

const CHUNK = 256 * 1024;
const BUFFER_LIMIT = 2 * 1024 * 1024;
const IDLE_MS = 120_000;
type Stream = {
  owner: string;
  projectId: string;
  socket: Socket;
  chunks: Buffer[];
  size: number;
  ended: boolean;
  error?: string;
  touched: number;
  reading: boolean;
  writing: boolean;
  wake?: () => void;
};

/** Private desktop TCP relay. Every stream stays bound to its paired device and project. */
export class DevServerAccess {
  private streams = new Map<string, Stream>();
  private opening = 0;
  private timer = setInterval(() => this.expire(), 15_000);

  constructor(
    private details: (params: Record<string, unknown>) => Promise<DevServerDetails>,
    private hostPort: () => number | undefined,
  ) {
    this.timer.unref();
  }

  private expire() {
    for (const [id, stream] of this.streams)
      if (Date.now() - stream.touched > IDLE_MS) this.dispose(id, stream);
  }

  close() {
    clearInterval(this.timer);
    for (const [id, stream] of this.streams) this.dispose(id, stream);
  }

  private dispose(id: string, stream: Stream) {
    stream.ended = true;
    stream.socket.destroy();
    stream.wake?.();
    this.streams.delete(id);
  }

  async endpoint(params: Record<string, unknown>) {
    const { server } = await this.details(params);
    const identity = params.identity as { pid?: unknown; startedAt?: unknown } | undefined;
    if (
      !params.projectId ||
      server.projectId !== params.projectId ||
      server.association === "uncertain" ||
      !server.process?.startedAt ||
      identity?.pid !== server.process.pid ||
      identity?.startedAt !== server.process.startedAt
    )
      throw new Error(
        "The development server must belong to this project and its process identity must match.",
      );
    const endpoint = server.endpoints.find(
      (entry) => entry.port === params.port && entry.address === params.address,
    );
    if (!endpoint || endpoint.port === this.hostPort())
      throw new Error("The selected development server endpoint is unavailable.");
    const url = new URL(endpoint.url);
    const address = endpoint.address.replace(/^\[|\]$/g, "");
    if (url.protocol !== "http:" || !isIP(address) || endpoint.port < 1 || endpoint.port > 65535)
      throw new Error(
        "Private browser access requires a discovered HTTP development server. Use the host preview for HTTPS.",
      );
    return {
      ...endpoint,
      connectAddress: address === "0.0.0.0" ? "127.0.0.1" : address === "::" ? "::1" : address,
    };
  }

  async handle(method: string, params: Record<string, unknown>, owner: string) {
    if (method === "devServers.bridgeCheck") return this.endpoint(params);
    if (method === "devServers.bridgeOpen") {
      if (this.streams.size + this.opening >= 64)
        throw new Error("Too many development server connections are open.");
      this.opening++;
      try {
        const endpoint = await this.endpoint(params);
        const socket = createConnection({ host: endpoint.connectAddress, port: endpoint.port });
        const stream: Stream = {
          owner,
          projectId: String(params.projectId),
          socket,
          chunks: [],
          size: 0,
          ended: false,
          touched: Date.now(),
          reading: false,
          writing: false,
        };
        const id = randomUUID();
        this.streams.set(id, stream);
        socket.setNoDelay(true);
        socket.on("data", (data: Buffer) => {
          stream.chunks.push(data);
          stream.size += data.length;
          stream.touched = Date.now();
          if (stream.size >= BUFFER_LIMIT) socket.pause();
          stream.wake?.();
        });
        socket.on("end", () => {
          stream.ended = true;
          stream.wake?.();
        });
        socket.on("close", () => {
          stream.ended = true;
          stream.wake?.();
        });
        socket.on("error", () => {
          stream.error = "The development server connection closed.";
          stream.ended = true;
          stream.wake?.();
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              socket.destroy();
              reject(new Error("Development server connection timed out."));
            }, 5000);
            const fail = () => {
              clearTimeout(timer);
              reject(new Error("The development server is unreachable."));
            };
            socket.once("error", fail);
            socket.once("connect", () => {
              clearTimeout(timer);
              socket.off("error", fail);
              resolve();
            });
          });
        } catch (error) {
          this.dispose(id, stream);
          throw error;
        }
        return { streamId: id };
      } finally {
        this.opening--;
      }
    }
    const id = String(params.streamId ?? "");
    const stream = this.streams.get(id);
    if (!stream || stream.owner !== owner || stream.projectId !== params.projectId)
      throw new Error("Development server connection expired or belongs to another device.");
    if (method === "devServers.bridgeClose") {
      this.dispose(id, stream);
      return { closed: true };
    }
    if (method === "devServers.bridgeWrite") {
      if (stream.writing) throw new Error("A development server write is already pending.");
      const encoded = params.data;
      if (
        typeof encoded !== "string" ||
        encoded.length > Math.ceil(CHUNK / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
      )
        throw new Error("Invalid development server data.");
      const data = Buffer.from(encoded, "base64");
      if (data.length > CHUNK || stream.ended)
        throw new Error("Development server connection closed.");
      stream.touched = Date.now();
      stream.writing = true;
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.dispose(id, stream);
            reject(new Error("Development server write timed out."));
          }, 10_000);
          stream.socket.write(data, (error) => {
            clearTimeout(timer);
            if (error) reject(error);
            else resolve();
          });
        });
      } finally {
        stream.writing = false;
      }
      return { written: data.length };
    }
    if (method !== "devServers.bridgeRead")
      throw new Error("Unsupported development server connection operation.");
    if (stream.reading) throw new Error("A development server read is already pending.");
    stream.reading = true;
    try {
      if (!stream.size && !stream.ended)
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            stream.wake = undefined;
            resolve();
          };
          const timer = setTimeout(finish, 1000);
          stream.wake = finish;
        });
      const size = Math.min(CHUNK, stream.size);
      const result = Buffer.allocUnsafe(size);
      let offset = 0;
      while (offset < size) {
        const chunk = stream.chunks[0];
        const count = Math.min(chunk.length, size - offset);
        chunk.copy(result, offset, 0, count);
        if (count === chunk.length) stream.chunks.shift();
        else stream.chunks[0] = chunk.subarray(count);
        offset += count;
      }
      stream.size -= size;
      if (size) stream.touched = Date.now();
      if (stream.size < BUFFER_LIMIT) stream.socket.resume();
      return {
        data: result.toString("base64"),
        ended: stream.ended && !stream.size,
        error: stream.error,
      };
    } finally {
      stream.reading = false;
    }
  }
}
