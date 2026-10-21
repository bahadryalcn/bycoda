import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

async function digest(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** Called only after unloading the POSIX service. A real file, rather than a
 * symlink into a versioned package, keeps its executable path stable. */
export async function preparePosixNode(executable: string, directory: string): Promise<string> {
  const engine = join(directory, "engine");
  const node = join(engine, "node");
  const expected = await digest(executable);
  try {
    if ((await digest(node)) === expected) return node;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(engine, { recursive: true, mode: 0o700 });
  const staged = join(engine, `node-${randomUUID()}.tmp`);
  try {
    await copyFile(executable, staged);
    if ((await digest(staged)) !== expected) throw new Error("The staged host engine checksum changed");
    await chmod(staged, 0o700);
    await rename(staged, node);
  } finally {
    await rm(staged, { force: true });
  }
  return node;
}
