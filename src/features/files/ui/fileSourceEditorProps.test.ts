import { describe, expect, it, vi } from "vitest";
import {
  fileSourceEditorKey,
  fileSourceEditorProps,
  type FileSourceEditorContract,
} from "./fileSourceEditorProps";

function contract(
  overrides: Partial<FileSourceEditorContract> = {},
): FileSourceEditorContract & Record<string, unknown> {
  return {
    path: "/work/project/notes.md",
    cwd: "/work/project",
    relativePath: "notes.md",
    content: "# disk text\n",
    retainedState: undefined,
    showDiff: false,
    gitOriginal: "# git text\n",
    navigation: undefined,
    onDirtyChange: vi.fn(),
    onErrorCountChange: vi.fn(),
    onSave: vi.fn(),
    saveRequestRef: { current: null },
    onStageGit: vi.fn(),
    onDocumentChange: vi.fn(),
    captureObserver: { current: null } as never,
    onEdit: vi.fn(),
    onOpenFile: vi.fn(),
    initialDraft: undefined,
    recoveryReviewRef: { current: false },
    pendingDiskRef: { current: false },
    ...overrides,
  } as FileSourceEditorContract & Record<string, unknown>;
}

describe("fileSourceEditorProps", () => {
  it("gives Plain and preview Source identical bindings, differing only in view props", () => {
    const shared = contract();
    const onDocChange = vi.fn();
    const plain = fileSourceEditorProps(shared, { active: true, shown: true });
    const source = fileSourceEditorProps(shared, { active: false, shown: true, onDocChange });

    const { active: plainActive, shown: plainShown, onDocChange: plainDoc, ...plainRest } = plain;
    const { active: srcActive, shown: srcShown, onDocChange: srcDoc, ...srcRest } = source;
    expect(plainDoc).toBeUndefined();
    expect(srcDoc).toBe(onDocChange);
    expect(plainActive).toBe(true);
    expect(srcActive).toBe(false);
    expect(plainShown).toBe(srcShown);

    // Callback bindings are the exact functions from the contract.
    for (const name of [
      "onSave",
      "onStageGit",
      "onDirtyChange",
      "onErrorCountChange",
      "onDocumentChange",
      "onEdit",
      "onOpenFile",
    ] as const) {
      expect(plainRest[name], name).toBe(shared[name]);
      expect(srcRest[name], name).toBe(shared[name]);
    }
    expect(plainRest.captureObserver).toBe(shared.captureObserver);
    expect(srcRest.captureObserver).toBe(shared.captureObserver);
    expect(plainRest.saveRequestRef).toBe(shared.saveRequestRef);
    expect(srcRest.saveRequestRef).toBe(shared.saveRequestRef);

    // Everything but the autosave closure is value/reference equal.
    const { canAutosave: plainAuto, ...plainStable } = plainRest;
    const { canAutosave: srcAuto, ...srcStable } = srcRest;
    expect(srcStable).toEqual(plainStable);
    expect(plainAuto()).toBe(srcAuto());
  });

  it("maps the contract onto the editor props", () => {
    const shared = contract();
    const props = fileSourceEditorProps(shared, { active: true, shown: false });
    expect(props.commentPath).toBe("notes.md");
    expect(props.value).toBe("# disk text\n");
    expect(props.path).toBe(shared.path);
    expect(props.cwd).toBe(shared.cwd);
    expect(props.gitOriginal).toBe("# git text\n");
    expect(props.shown).toBe(false);
    expect("relativePath" in props).toBe(false);
    expect("content" in props).toBe(false);
    expect("recoveryReviewRef" in props).toBe(false);
    expect("pendingDiskRef" in props).toBe(false);
  });

  it("blocks autosave while a pending disk change or a recovery review exists, read at call time", () => {
    const shared = contract();
    const { canAutosave } = fileSourceEditorProps(shared, { active: true, shown: true });
    expect(canAutosave?.()).toBe(true);
    shared.pendingDiskRef.current = true;
    expect(canAutosave?.()).toBe(false);
    shared.pendingDiskRef.current = false;
    shared.recoveryReviewRef.current = true;
    expect(canAutosave?.()).toBe(false);
    shared.pendingDiskRef.current = true;
    expect(canAutosave?.()).toBe(false);
    shared.pendingDiskRef.current = false;
    shared.recoveryReviewRef.current = false;
    expect(canAutosave?.()).toBe(true);
  });

  it("marks a recovered draft dirty only while its explicit recovery review is open", () => {
    const initialDraft = { text: "draft" } as never;
    const reviewing = contract({ initialDraft, recoveryReviewRef: { current: true } });
    expect(fileSourceEditorProps(reviewing, { active: true, shown: true }).initialDirty).toBe(true);
    const settled = contract({ initialDraft, recoveryReviewRef: { current: false } });
    expect(fileSourceEditorProps(settled, { active: true, shown: true }).initialDirty).toBe(false);
    const noDraft = contract({ recoveryReviewRef: { current: true } });
    expect(fileSourceEditorProps(noDraft, { active: true, shown: true }).initialDirty).toBe(false);
  });
});

describe("fileSourceEditorKey", () => {
  it("keeps the documentId:reloadKey:editorRevision format", () => {
    expect(fileSourceEditorKey("doc-1", 2, 3)).toBe("doc-1:2:3");
    expect(fileSourceEditorKey("file:///a b/c.md", 0, 0)).toBe("file:///a b/c.md:0:0");
  });

  it("changes with any component", () => {
    const base = fileSourceEditorKey("doc", 1, 1);
    expect(fileSourceEditorKey("doc2", 1, 1)).not.toBe(base);
    expect(fileSourceEditorKey("doc", 2, 1)).not.toBe(base);
    expect(fileSourceEditorKey("doc", 1, 2)).not.toBe(base);
  });
});
