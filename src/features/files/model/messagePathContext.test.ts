import { beforeEach, describe, expect, it, vi } from "vitest";

const { statFiles, listDir } = vi.hoisted(() => ({ statFiles: vi.fn(), listDir: vi.fn() }));
vi.mock("../../../platform/tauri/fs", () => ({ statFiles, listDir }));

const existsOnly = (expected: string) => async (paths: string[]) =>
  paths.map((path) => ({ path, mtimeMs: path === expected ? 1 : null }));
const folder = (path: string) => ({ name: path.split("/").pop()!, path, isDir: true });

import {
  messageFileCandidates,
  resolveMessageFileReference,
  sessionFileCandidates,
} from "./messagePathContext";

const message = [
  "Full path: `/repo/temp/local/2026-10-15-ui-performance/`",
  "It contains `prompts.md`, `plan.md` and `analyzer/`.",
  "See also [notes](docs/guides/notes.md).",
].join("\n");

describe("message path context", () => {
  beforeEach(() => {
    statFiles.mockReset();
    listDir.mockReset();
    listDir.mockResolvedValue([]);
  });

  it("places a bare file under the folders the message names", () => {
    expect(messageFileCandidates("/repo/prompts.md", "/repo", message)).toEqual([
      "/repo/temp/local/2026-10-15-ui-performance/prompts.md",
      "/repo/analyzer/prompts.md",
      "/repo/docs/guides/prompts.md",
      "/repo/docs/guides/notes.md/prompts.md",
    ]);
  });

  it("has no candidates for paths outside the project or messages without folders", () => {
    expect(messageFileCandidates("/elsewhere/prompts.md", "/repo", message)).toEqual([]);
    expect(messageFileCandidates("/repo/prompts.md", "/repo", "Only `prompts.md`.")).toEqual([]);
  });

  it("finds the file in an ignored folder named by the message", async () => {
    statFiles.mockImplementation(async (paths: string[]) =>
      paths.map((path) => ({
        path,
        mtimeMs: path.includes("/temp/local/") ? 1 : null,
      })),
    );
    await expect(resolveMessageFileReference("/repo/prompts.md", "/repo", message)).resolves.toBe(
      "/repo/temp/local/2026-10-15-ui-performance/prompts.md",
    );
  });

  it("keeps an existing project-root file", async () => {
    statFiles.mockImplementation(async (paths: string[]) =>
      paths.map((path) => ({ path, mtimeMs: 1 })),
    );
    await expect(resolveMessageFileReference("/repo/prompts.md", "/repo", message)).resolves.toBe(
      "/repo/prompts.md",
    );
  });

  it.each(["html", "pdf", "docx"])(
    "finds a generated %s in a project-prefixed folder",
    async (extension) => {
      const cwd = "G:/Projects/Acme/UI DEVELOPMENTS/ui-tests";
      const name = `Acme-Observer-Yatirimci-Sunumu.${extension}`;
      const expected = `${cwd}/investor-deck/${name}`;
      const text = `Sunumu hazırladım; hepsi \`ui-tests/investor-deck/\` klasöründe:\n- \`${name}\``;
      statFiles.mockImplementation(async (paths: string[]) =>
        paths.map((path) => ({ path, mtimeMs: path === expected ? 1 : null })),
      );
      await expect(resolveMessageFileReference(`${cwd}/${name}`, cwd, text)).resolves.toBe(
        expected,
      );
      expect(statFiles).toHaveBeenCalledWith(expect.arrayContaining([expected]));
    },
  );

  it("preserves a real nested folder with the same name as the project", async () => {
    const cwd = "/repo/ui-tests";
    const expected = `${cwd}/ui-tests/investor-deck/report.html`;
    statFiles.mockImplementation(async (paths: string[]) =>
      paths.map((path) => ({
        path,
        mtimeMs: path.endsWith("/report.html") && path !== `${cwd}/report.html` ? 1 : null,
      })),
    );
    await expect(
      resolveMessageFileReference(`${cwd}/report.html`, cwd, "`ui-tests/investor-deck/`"),
    ).resolves.toBe(expected);
  });

  it("finds a bare file next to files the session's tools touched outside the project", async () => {
    const cwd = "G:/Projects/monocode";
    const sessionPaths = [
      "G:/Projects/bykit/temp/read.patch",
      "G:/Projects/bykit/src/port.rs",
      "G:/Projects/bykit/src/page.rs",
    ];
    const text = "Now the outline work in `read.rs`.";
    expect(sessionFileCandidates(`${cwd}/read.rs`, cwd, sessionPaths)).toEqual([
      "G:/Projects/bykit/temp/read.rs",
      "G:/Projects/bykit/src/read.rs",
    ]);
    statFiles.mockImplementation(async (paths: string[]) =>
      paths.map((path) => ({ path, mtimeMs: path === "G:/Projects/bykit/src/read.rs" ? 1 : null })),
    );
    await expect(
      resolveMessageFileReference(`${cwd}/read.rs`, cwd, text, sessionPaths),
    ).resolves.toBe("G:/Projects/bykit/src/read.rs");
  });

  it("prefers a file the session touched with the same relative path", () => {
    expect(
      sessionFileCandidates("/repo/src/port.rs", "/repo", [
        "/tools/a/b.rs",
        "/tools/x/src/port.rs",
      ]),
    ).toEqual(["/tools/x/src/port.rs", "/tools/a/src/port.rs", "/tools/x/src/src/port.rs"]);
  });

  it("searches inside a folder the session listed", () => {
    expect(
      sessionFileCandidates("G:/Projects/monocode/read.rs", "G:/Projects/monocode", [
        "G:/Projects/bykit/src/",
      ]),
    ).toEqual(["G:/Projects/bykit/src/read.rs"]);
  });

  it("finds a file in a sibling of the folder the session worked in", async () => {
    const cwd = "G:/Projects/my_projects/monocode";
    const expected = "G:/Projects/my_projects/bykit/src/read.rs";
    listDir.mockImplementation(async (path: string) =>
      path === "G:/Projects/my_projects/bykit"
        ? [
            folder("G:/Projects/my_projects/bykit/target"),
            folder("G:/Projects/my_projects/bykit/src"),
            folder("G:/Projects/my_projects/bykit/temp"),
          ]
        : [],
    );
    statFiles.mockImplementation(existsOnly(expected));
    await expect(
      resolveMessageFileReference(`${cwd}/read.rs`, cwd, "`read.rs`", [
        "G:/Projects/my_projects/bykit/temp/read.patch",
      ]),
    ).resolves.toBe(expected);
    // Build output is never listed, and the folder holding every project is too broad.
    expect(listDir).toHaveBeenCalledWith("G:/Projects/my_projects/bykit/temp");
    expect(listDir).toHaveBeenCalledWith("G:/Projects/my_projects/bykit");
    expect(listDir).not.toHaveBeenCalledWith("G:/Projects/my_projects");
    expect(statFiles).not.toHaveBeenCalledWith(
      expect.arrayContaining(["G:/Projects/my_projects/bykit/target/read.rs"]),
    );
  });

  it("leaves project files to the project index", async () => {
    statFiles.mockImplementation(existsOnly(""));
    await expect(
      resolveMessageFileReference("/repo/a.ts", "/repo", "`a.ts`", ["/repo/src/deep/b.ts"]),
    ).resolves.toBe("/repo/a.ts");
    expect(listDir).not.toHaveBeenCalled();
  });

  it("returns the original path when nothing exists", async () => {
    statFiles.mockImplementation(async (paths: string[]) =>
      paths.map((path) => ({ path, mtimeMs: null })),
    );
    await expect(resolveMessageFileReference("/repo/prompts.md", "/repo", message)).resolves.toBe(
      "/repo/prompts.md",
    );
  });
});
