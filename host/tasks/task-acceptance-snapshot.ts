import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { join, relative, sep, win32 } from "node:path";

const MAX_ENTRIES = 2000;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_PATH = 4096;

/** These are credentials and repository metadata, never task output evidence. */
const restricted = (part: string) =>
  /^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|\.gnupg|\.bycoda(?:-host)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|credentials(?:\.[^.]+)?|secrets?(?:\.[^.]+)?)$/i.test(
    part,
  ) || /\.(?:pem|key|p12|pfx)$/i.test(part);

/** Hash only declared local output references. This does not prove external evidence or completeness. */
export async function acceptanceOutputFingerprint(
  cwd: string,
  deliverables: readonly string[],
  artifactPaths: readonly string[] = [],
): Promise<{ fingerprint: string; paths: string[] } | undefined> {
  try {
    if (deliverables.length + artifactPaths.length > MAX_ENTRIES) return;
    const root = await realpath(cwd);
    if (!(await lstat(root)).isDirectory()) return;
    const contained = (path: string) => {
      const rel = relative(root, path);
      return rel !== ".." && !rel.startsWith(`..${sep}`) && !win32.isAbsolute(rel);
    };
    const info = async (path: string) => {
      const parts = path.split("/");
      if (parts.some(restricted)) throw new Error("Credential paths are not output evidence.");
      let current = root;
      for (const part of parts) {
        current = join(current, part);
        try {
          if ((await lstat(current)).isSymbolicLink())
            throw new Error("Output evidence cannot follow symbolic links.");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
          throw error;
        }
      }
      if (!contained(await realpath(current)))
        throw new Error("Output path escaped its workspace.");
      return lstat(current);
    };
    const paths = new Set<string>();
    for (const [index, entry] of [...deliverables, ...artifactPaths].entries()) {
      if (typeof entry !== "string" || entry.length > MAX_PATH) return;
      let path = entry.trim();
      if (!path || /^[a-z][a-z\d+.-]*:\/\//i.test(path)) continue;
      const quoted = /^(?:`[^`]+`|"[^"]+"|'[^']+')$/.test(path);
      if (quoted) path = path.slice(1, -1);
      if (/^[a-z]:/i.test(path) || /^[\\/~]/.test(path) || win32.isAbsolute(path)) return;
      const parts = path.replaceAll("\\", "/").split("/");
      if (parts.includes("..") || path.includes("\0")) return;
      const candidate = parts.filter((part) => part && part !== ".").join("/");
      if (!candidate) return;
      // Unquoted prose and wildcard instructions are not explicit local output paths.
      if (/[<>*?|:]/.test(candidate) || [...candidate].some((char) => char.charCodeAt(0) < 32))
        continue;
      const existing = await info(candidate);
      const explicit = candidate.includes("/") || /\.[a-z\d][a-z\d_-]{0,15}$/i.test(candidate);
      const recordedPath = index >= deliverables.length;
      if (
        !recordedPath &&
        ((!explicit && !existing) || (!quoted && /\s/.test(candidate) && !existing))
      )
        continue;
      paths.add(candidate);
    }
    const selected = [...paths].sort();
    const digest = createHash("sha256").update("bycoda.acceptance-outputs.v1\n");
    let entries = 0;
    let bytes = 0;
    const walk = async (path: string): Promise<void> => {
      if (++entries > MAX_ENTRIES) throw new Error("Output evidence exceeds its entry limit.");
      const before = await info(path);
      if (!before) {
        digest.update(JSON.stringify(["missing", path]) + "\n");
        return;
      }
      if (before.isDirectory()) {
        digest.update(JSON.stringify(["directory", path]) + "\n");
        for (const name of (await readdir(join(root, path))).sort()) await walk(`${path}/${name}`);
        const after = await info(path);
        if (!after?.isDirectory() || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino)
          throw new Error("Output directory changed during its snapshot.");
        return;
      }
      if (!before.isFile() || before.size > MAX_BYTES - bytes)
        throw new Error("Output evidence exceeds its size limit or is not a regular file.");
      const handle = await open(join(root, path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const opened = await handle.stat();
        // Check the opened identity and parents before reading any file bytes.
        const current = await info(path);
        if (
          !opened.isFile() ||
          !current ||
          opened.ino !== before.ino ||
          opened.dev !== before.dev ||
          opened.ino !== current.ino ||
          opened.dev !== current.dev
        )
          throw new Error("Output file changed before its snapshot.");
        const content = createHash("sha256");
        let fileBytes = 0;
        for await (const chunk of handle.createReadStream({
          autoClose: false,
          highWaterMark: 64 * 1024,
        })) {
          fileBytes += chunk.length;
          bytes += chunk.length;
          if (bytes > MAX_BYTES) throw new Error("Output evidence exceeds its size limit.");
          content.update(chunk);
        }
        const after = await handle.stat();
        const final = await info(path);
        if (
          after.size !== fileBytes ||
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs ||
          !final?.isFile() ||
          final.ino !== opened.ino ||
          final.dev !== opened.dev
        )
          throw new Error("Output file changed during its snapshot.");
        digest.update(JSON.stringify(["file", path, content.digest("hex")]) + "\n");
      } finally {
        await handle.close();
      }
    };
    for (const path of selected) await walk(path);
    return { fingerprint: digest.digest("hex"), paths: selected };
  } catch {
    // Unknown or unstable evidence must never be interpreted as an unchanged result.
    return;
  }
}
