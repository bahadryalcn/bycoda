// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import type { ProjectFile } from "../../../platform/tauri/fs";

const truncated = vi.hoisted(() => vi.fn<(files: ProjectFile[]) => boolean | undefined>());
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  projectFilesTruncated: truncated,
}));

const index = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../../files/public/fileIndex", () => ({
  loadProjectFiles: index.load,
  peekProjectFiles: () => undefined,
  recentOpenedFiles: () => [],
  subscribeProjectFiles: () => () => {},
}));

import { projectIndexNotice, useComposerProjectFiles } from "./useComposerMentionSources";

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

it("forces one fresh remote file-index read for an explicit retry", async () => {
  const cwd = "remote://office/fixture";
  index.load.mockReset().mockResolvedValue(files);
  index.load.mockRejectedValueOnce(new Error("Index unavailable"));
  const root = createRoot(document.createElement("div"));
  let retry: (() => void) | undefined;
  function Fixture({ mentionOpen }: { mentionOpen: boolean }) {
    const state = useComposerProjectFiles({ cwd, remote: true, mentionOpen });
    return createElement("button", {
      onClick: () => state.retry(),
      ref: (button: HTMLButtonElement | null) => {
        retry = button ? () => button.click() : undefined;
      },
    });
  }
  try {
    await act(async () => root.render(createElement(Fixture, { mentionOpen: true })));
    await act(async () => retry?.());
    await act(async () => root.render(createElement(Fixture, { mentionOpen: false })));
    expect(index.load.mock.calls).toEqual([
      [cwd, false],
      [cwd, true],
      [cwd, false],
    ]);
  } finally {
    await act(async () => root.unmount());
  }
});
