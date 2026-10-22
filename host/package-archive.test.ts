import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
// @ts-expect-error JavaScript packaging helper runs directly under Node.
import { createTarArchive, extractTarMembers } from "./package-archive.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("uses owned archive file descriptors and no native absolute paths in tar argv", () => {
  const root = mkdtempSync(join(tmpdir(), "bycoda archive streams "));
  roots.push(root);
  const archive = join(root, "runtime.tar.gz");
  const output = join(root, "host.tar.gz");
  const destination = join(root, "destination");
  writeFileSync(archive, "fixture");
  const run = vi.fn();
  extractTarMembers(archive, destination, ["node-v24/bin/node", "node-v24/LICENSE"], run);
  expect(run).toHaveBeenLastCalledWith(
    "tar",
    ["-xzf", "-", "--strip-components=1", "node-v24/bin/node", "node-v24/LICENSE"],
    { cwd: destination, windowsHide: true, stdio: [expect.any(Number), "pipe", "pipe"] },
  );
  const inputFd = run.mock.calls[0][2].stdio[0];
  expect(() => fstatSync(inputFd)).toThrow();
  createTarArchive(output, destination, run);
  expect(run).toHaveBeenLastCalledWith("tar", ["-czf", "-", "."], {
    cwd: destination,
    windowsHide: true,
    stdio: ["ignore", expect.any(Number), "pipe"],
  });
  const outputFd = run.mock.calls[1][2].stdio[1];
  expect(() => fstatSync(outputFd)).toThrow();
});

const implementations = [
  "tar",
  ...(process.platform === "win32" && existsSync("C:/Windows/System32/tar.exe")
    ? ["C:/Windows/System32/tar.exe"]
    : []),
  ...(process.platform === "win32" && existsSync("C:/Program Files/Git/usr/bin/tar.exe")
    ? ["C:/Program Files/Git/usr/bin/tar.exe"]
    : []),
];
it.each(implementations)(
  "creates host archives and extracts runtime members through real %s with spaced absolute paths",
  (executable) => {
    const root = mkdtempSync(join(tmpdir(), "bycoda archive paths "));
    roots.push(root);
    const source = join(root, "source tree");
    const destination = join(root, "destination tree");
    const archive = join(root, "runtime archive.tar.gz");
    const hostArchive = join(root, "host archive.tar.gz");
    mkdirSync(join(source, "node-test", "bin"), { recursive: true });
    mkdirSync(destination);
    writeFileSync(join(source, "node-test", "bin", "node"), "synthetic runtime\n");
    writeFileSync(join(source, "node-test", "LICENSE"), "synthetic license\n");
    writeFileSync(join(source, "node-test", "excluded.txt"), "not selected\n");
    const run = (_command: string, args: string[], options: object) =>
      execFileSync(executable, args, options);
    createTarArchive(hostArchive, source, run);
    const listing = execFileSync(executable, ["-tzf", basename(hostArchive)], {
      cwd: root,
      windowsHide: true,
      encoding: "utf8",
    });
    expect(listing).toContain("node-test/bin/node");
    // Official runtime archives name their stem directly; host archives retain
    // their existing leading ./ entries.
    const fd = openSync(archive, "w");
    try {
      execFileSync(executable, ["-czf", "-", "node-test"], {
        cwd: source,
        windowsHide: true,
        stdio: ["ignore", fd, "pipe"],
      });
    } finally {
      closeSync(fd);
    }
    extractTarMembers(archive, destination, ["node-test/bin/node", "node-test/LICENSE"], run);
    expect(readFileSync(join(destination, "bin", "node"), "utf8")).toBe("synthetic runtime\n");
    expect(readFileSync(join(destination, "LICENSE"), "utf8")).toBe("synthetic license\n");
    expect(existsSync(join(destination, "excluded.txt"))).toBe(false);
  },
);
