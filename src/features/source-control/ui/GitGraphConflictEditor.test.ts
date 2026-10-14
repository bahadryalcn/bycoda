// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GitGraphConflictEditor } from "./GitGraphConflictEditor";
import {
  gitConflictStages,
  gitResolveConflict,
  gitStageFile,
  readTextFile,
  writeTextFile,
} from "../../../platform/tauri/fs";

vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  gitConflictStages: vi.fn(),
  gitResolveConflict: vi.fn(),
  gitStageFile: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));
vi.mock("./UnifiedDiffView", () => ({ UnifiedDiffView: () => null }));
vi.mock("./DiffLayoutToggle", () => ({ DiffLayoutToggle: () => null }));
let root: Root;
let host: HTMLDivElement;
const markers = "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> topic\n";
const stages = {
  path: "/repo/conflict.txt",
  relative: "conflict.txt",
  kind: "both-modified" as const,
  ours: "ours\n",
  theirs: "theirs\n",
  base: "base\n",
  binary: false,
  tooLarge: false,
};
const onResolved = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(gitConflictStages).mockResolvedValue(stages);
  vi.mocked(readTextFile).mockResolvedValue(markers);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () =>
    root.render(
      createElement(GitGraphConflictEditor, {
        cwd: "/repo",
        path: stages.path,
        relative: stages.relative,
        disabled: false,
        onDirty: vi.fn(),
        onResolved,
        run: async (_label, action) => {
          try {
            await action();
            return true;
          } catch {
            return false;
          }
        },
      }),
    ),
  );
}
async function click(text: string) {
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === text)!
      .click(),
  );
}

it("marker varken stage etmez, seçilen sonucu dosyaya yazıp stage eder", async () => {
  await mount();
  expect(host.querySelector(".conflict-pane-ours")?.textContent).toContain("HEAD");
  expect(host.querySelector(".conflict-pane-theirs")?.textContent).toContain("topic");
  expect(host.querySelector(".conflict-pane-ours strong")?.getAttribute("title")).toContain(
    "Current side of conflict markers",
  );
  expect(
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Save and stage",
    )?.disabled,
  ).toBe(true);
  await click("Incoming");
  await click("Save and stage");
  expect(writeTextFile).toHaveBeenCalledWith(stages.path, "theirs\n");
  expect(gitStageFile).toHaveBeenCalledWith("/repo", stages.relative);
  expect(onResolved).toHaveBeenCalledOnce();
});

it("diskte dışarıdan değişmiş dosyanın üzerine yazmaz", async () => {
  await mount();
  await click("Current");
  vi.mocked(readTextFile).mockResolvedValue("external edit");
  await click("Save and stage");
  expect(writeTextFile).not.toHaveBeenCalled();
  expect(gitStageFile).not.toHaveBeenCalled();
  expect(onResolved).not.toHaveBeenCalled();
});

it("stage hatasından sonra sonucu korur ve aynı dosyaya güvenle tekrar dener", async () => {
  await mount();
  await click("Incoming");
  vi.mocked(gitStageFile).mockRejectedValueOnce(new Error("Index temporarily locked"));
  await click("Save and stage");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Index temporarily locked");
  expect(onResolved).not.toHaveBeenCalled();
  vi.mocked(readTextFile).mockResolvedValue("theirs\n");
  await click("Save and stage");
  expect(gitStageFile).toHaveBeenCalledTimes(2);
  expect(onResolved).toHaveBeenCalledOnce();
});

it("binary conflict için metin okumadan tüm dosya tarafını çözer", async () => {
  vi.mocked(gitConflictStages).mockResolvedValue({ ...stages, binary: true });
  await mount();
  await click("Use incoming");
  expect(readTextFile).not.toHaveBeenCalled();
  expect(writeTextFile).not.toHaveBeenCalled();
  expect(gitResolveConflict).toHaveBeenCalledWith("/repo", stages.relative, "theirs");
});

it("silinmiş tarafı boş dosya oluşturmak yerine git ile uygular", async () => {
  vi.mocked(gitConflictStages).mockResolvedValue({
    ...stages,
    ours: null,
    kind: "deleted-by-us",
  });
  vi.mocked(readTextFile).mockRejectedValue(new Error("missing"));
  await mount();
  await click("Use current");
  expect(writeTextFile).not.toHaveBeenCalled();
  expect(gitResolveConflict).toHaveBeenCalledWith("/repo", stages.relative, "ours");
});
