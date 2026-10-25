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
  expect(
    host.querySelector(".conflict-pane-ours .conflict-source-identity")?.getAttribute("title"),
  ).toContain("Current side of conflict markers");
  expect(
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Save and stage",
    )?.disabled,
  ).toBe(true);
  await click("Accept Incoming");
  await click("Save and stage");
  expect(writeTextFile).toHaveBeenCalledWith(stages.path, "theirs\n");
  expect(gitStageFile).toHaveBeenCalledWith("/repo", stages.relative);
  expect(onResolved).toHaveBeenCalledOnce();
});

it("diskte dışarıdan değişmiş dosyanın üzerine yazmaz", async () => {
  await mount();
  await click("Accept Current");
  vi.mocked(readTextFile).mockResolvedValue("external edit");
  await click("Save and stage");
  expect(writeTextFile).not.toHaveBeenCalled();
  expect(gitStageFile).not.toHaveBeenCalled();
  expect(onResolved).not.toHaveBeenCalled();
});

it("stage hatasından sonra sonucu korur ve aynı dosyaya güvenle tekrar dener", async () => {
  await mount();
  await click("Accept Incoming");
  vi.mocked(gitStageFile).mockRejectedValueOnce(new Error("Index temporarily locked"));
  await click("Save and stage");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Index temporarily locked");
  expect(onResolved).not.toHaveBeenCalled();
  vi.mocked(readTextFile).mockResolvedValue("theirs\n");
  await click("Save and stage");
  expect(gitStageFile).toHaveBeenCalledTimes(2);
  expect(onResolved).toHaveBeenCalledOnce();
});

it.each(["\r\n", "\n"])(
  "preserves %j context line endings and retries against the serialized disk",
  async (eol) => {
    const initial = `before\n${markers}after\n`.replace(/\n/g, eol);
    let disk = initial;
    vi.mocked(readTextFile).mockImplementation(async () => disk);
    vi.mocked(writeTextFile).mockImplementation(async (_path, text) => {
      disk = text;
    });
    vi.mocked(gitStageFile).mockRejectedValueOnce(new Error("Index temporarily locked"));
    await mount();
    await click("Accept Incoming");
    await click("Save and stage");
    expect(disk).toBe(`before${eol}theirs${eol}after${eol}`);
    expect(onResolved).not.toHaveBeenCalled();
    await click("Save and stage");
    expect(writeTextFile).toHaveBeenCalledTimes(2);
    expect(gitStageFile).toHaveBeenCalledTimes(2);
    expect(onResolved).toHaveBeenCalledOnce();
  },
);

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

it("keeps only the chosen whole-file action loading and rejects duplicate pending resolution", async () => {
  vi.mocked(gitConflictStages).mockResolvedValue({ ...stages, binary: true });
  let reject!: (reason: Error) => void;
  vi.mocked(gitResolveConflict).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await mount();
  const incoming = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === "Use incoming",
  )!;
  incoming.focus();
  await act(async () => {
    incoming.click();
    incoming.click();
  });
  expect(gitResolveConflict).toHaveBeenCalledTimes(1);
  expect(incoming.getAttribute("aria-busy")).toBe("true");
  expect(document.activeElement).toBe(incoming);
  expect(host.querySelectorAll('button[aria-busy="true"]')).toHaveLength(1);
  expect(
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent === "Use current",
    )!.disabled,
  ).toBe(true);
  await act(async () => reject(new Error("Index locked")));
  expect(incoming.getAttribute("aria-busy")).not.toBe("true");
  expect(document.activeElement).toBe(incoming);
  expect(onResolved).not.toHaveBeenCalled();
});

it("keeps a plain conflict draft after a deferred save failure and allows the same button to retry", async () => {
  vi.mocked(readTextFile).mockResolvedValue("original\n");
  let reject!: (reason: Error) => void;
  vi.mocked(writeTextFile).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await mount();
  const output = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Resolved output"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      output,
      "my resolution\n",
    );
    output.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const save = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === "Save and stage",
  )!;
  save.focus();
  await act(async () => {
    save.click();
    save.click();
  });
  expect(writeTextFile).toHaveBeenCalledTimes(1);
  expect(save.getAttribute("aria-busy")).toBe("true");
  expect(output.disabled).toBe(true);
  await act(async () => reject(new Error("Disk unavailable")));
  expect(output.value).toBe("my resolution\n");
  expect(document.activeElement).toBe(save);
  expect(save.getAttribute("aria-busy")).not.toBe("true");
  vi.mocked(writeTextFile).mockResolvedValue(undefined);
  await act(async () => save.click());
  expect(writeTextFile).toHaveBeenCalledTimes(2);
  expect(onResolved).toHaveBeenCalledOnce();
});
