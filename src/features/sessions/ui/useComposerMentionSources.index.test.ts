import { beforeEach, expect, it, vi } from "vitest";
import type { ProjectFile } from "../../../platform/tauri/fs";

const truncated = vi.hoisted(() => vi.fn<(files: ProjectFile[]) => boolean | undefined>());
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  projectFilesTruncated: truncated,
}));

import { projectIndexNotice } from "./useComposerMentionSources";

const files: ProjectFile[] = [{ name: "a.ts", path: "/repo/a.ts", relative: "a.ts" }];

beforeEach(() => truncated.mockReset());

it("reports a capped index so a missing late file is not read as 'no such file'", () => {
  truncated.mockReturnValue(true);
  expect(projectIndexNotice(files)).toBe("incomplete");
});

it("keeps a complete index and a not-yet-loaded index quiet", () => {
  truncated.mockReturnValue(false);
  expect(projectIndexNotice(files)).toBeUndefined();
  truncated.mockReturnValue(true);
  expect(projectIndexNotice([])).toBeUndefined();
});

it("marks a Host that does not report completeness as unknown", () => {
  truncated.mockReturnValue(undefined);
  expect(projectIndexNotice(files)).toBe("unknown");
});
