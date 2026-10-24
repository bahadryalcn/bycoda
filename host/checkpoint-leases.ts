import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Lease = {
  owner: "host" | "native";
  sessionId: string;
  turnId: string;
  cwd: string;
  shared: boolean;
};
const valid = (v: string) => /^[A-Za-z0-9_-]{1,128}$/.test(v);
const overlap = (a: string, b: string) => {
  const normalize = (p: string) => {
    p = p
      .replace(/\\/g, "/")
      .replace(/^\/\/\?\//, "")
      .replace(/\/$/, "");
    return process.platform === "win32" ? p.toLowerCase() : p;
  };
  a = normalize(a);
  b = normalize(b);
  return a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
};
/** Same active-turn protocol as the native checkpoint store; errors fail closed. */
export class CheckpointLeases {
  constructor(private root: string) {}
  private name(session: string, turn: string) {
    if (!valid(session) || !valid(turn)) throw new Error("Invalid checkpoint ID");
    return `host-${session}-${turn}.json`;
  }
  private async read(): Promise<[string, Lease][]> {
    const names = await readdir(this.root).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
    const result: [string, Lease][] = [];
    for (const name of names.filter((n) => n.endsWith(".json"))) {
      const bytes = await readFile(join(this.root, name), "utf8").catch(
        (e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT") return undefined;
          throw e;
        },
      );
      if (bytes === undefined) continue;
      const lease = JSON.parse(bytes) as Lease;
      if (
        !valid(lease.sessionId) ||
        !valid(lease.turnId) ||
        !["host", "native"].includes(lease.owner) ||
        typeof lease.cwd !== "string"
      )
        throw new Error("Invalid checkpoint lease");
      result.push([name, lease]);
    }
    return result;
  }
  private async write(name: string, lease: Lease) {
    await mkdir(this.root, { recursive: true });
    const tmp = join(this.root, `lease-${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(lease));
    await rename(tmp, join(this.root, name));
  }
  private async markShared(name: string) {
    const file = await open(join(this.root, name), "r+").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!file) return;
    try {
      const bytes = await file.readFile("utf8");
      if (JSON.parse(bytes).shared === true) return;
      const field = /"shared"\s*:\s*false/.exec(bytes);
      if (!field) throw new Error("Invalid checkpoint lease shared flag");
      const offset = Buffer.byteLength(bytes.slice(0, field.index + field[0].lastIndexOf("false")));
      // Fixed-width JSON update through an existing handle: a peer's unlink
      // cannot be undone by this write, unlike an atomic replace by filename.
      const { bytesWritten } = await file.write(Buffer.from("true "), 0, 5, offset);
      if (bytesWritten !== 5) throw new Error("Incomplete checkpoint lease update");
    } finally {
      await file.close();
    }
  }
  async publish(session: string, turn: string, cwd: string) {
    const name = this.name(session, turn);
    const own: Lease = {
      owner: "host",
      sessionId: session,
      turnId: turn,
      cwd: await realpath(cwd),
      shared: await this.shared(session, turn),
    };
    await this.write(name, own);
    for (const [otherName, other] of await this.read()) {
      if (otherName !== name && overlap(own.cwd, other.cwd)) {
        own.shared = true;
        await this.markShared(otherName);
      }
    }
    if (own.shared) await this.write(name, own);
    return own.shared;
  }
  async shared(session: string, turn: string) {
    const name = this.name(session, turn);
    return (await this.read()).some(([n, l]) => n === name && l.shared);
  }
  async active(cwd: string) {
    return (await this.read()).some(([, l]) => overlap(cwd, l.cwd));
  }
  /** Candidate discovery only: the manifest remains authoritative. Publish
   * precedes capture and release follows settlement in both runtimes. */
  async sessions(owner: Lease["owner"], cwd: string): Promise<string[]> {
    return [
      ...new Set(
        (await this.read())
          .filter(([, lease]) => lease.owner === owner && overlap(cwd, lease.cwd))
          .map(([, lease]) => lease.sessionId),
      ),
    ];
  }
  async release(session: string, turn: string) {
    await rm(join(this.root, this.name(session, turn)), { force: true });
  }
}
