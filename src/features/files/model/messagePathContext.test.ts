import { beforeEach, describe, expect, it, vi } from "vitest";

const statFiles = vi.hoisted(() => vi.fn());
vi.mock("../../../platform/tauri/fs", () => ({ statFiles }));

import { messageFileCandidates, resolveMessageFileReference } from "./messagePathContext";

const message = [
  "Full path: `/repo/temp/local/2026-10-15-ui-performance/`",
  "It contains `prompts.md`, `plan.md` and `analyzer/`.",
  "See also [notes](docs/guides/notes.md).",
].join("\n");

describe("message path context", () => {
  beforeEach(() => {
    statFiles.mockReset();
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

  it("returns the original path when nothing exists", async () => {
    statFiles.mockImplementation(async (paths: string[]) =>
      paths.map((path) => ({ path, mtimeMs: null })),
    );
    await expect(resolveMessageFileReference("/repo/prompts.md", "/repo", message)).resolves.toBe(
      "/repo/prompts.md",
    );
  });
});
