import { afterEach, expect, it, vi } from "vitest";
import { message } from "@tauri-apps/plugin-dialog";
import { prepareEditorsToClose, registerClosingEditor, type ClosingEditor } from "./editorClose";

vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn() }));
const releases: (() => void)[] = [];
afterEach(() => {
  releases.splice(0).forEach((release) => release());
  vi.clearAllMocks();
});
function editor(overrides: Partial<ClosingEditor> = {}) {
  let dirty = true;
  const entry: ClosingEditor = {
    path: "/work/file.ts",
    dirty: () => dirty,
    settle: async () => {},
    save: vi.fn(async () => {
      dirty = false;
      return true;
    }),
    ...overrides,
  };
  releases.push(registerClosingEditor(entry));
  return entry;
}
it("waits for a pending autosave before deciding whether a prompt is needed", async () => {
  let finish!: () => void;
  let dirty = true;
  const pending = new Promise<void>((resolve) => {
    finish = () => {
      dirty = false;
      resolve();
    };
  });
  editor({ dirty: () => dirty, settle: () => pending });
  const closing = prepareEditorsToClose();
  await Promise.resolve();
  expect(message).not.toHaveBeenCalled();
  finish();
  expect(await closing).toBe(true);
  expect(message).not.toHaveBeenCalled();
});
it("retains dirty edits when cancelled", async () => {
  const entry = editor();
  vi.mocked(message).mockResolvedValue("Cancel");
  expect(await prepareEditorsToClose()).toBe(false);
  expect(entry.dirty()).toBe(true);
  expect(entry.save).not.toHaveBeenCalled();
});
it("allows explicit discard without saving", async () => {
  const entry = editor();
  vi.mocked(message).mockResolvedValue("Discard");
  expect(await prepareEditorsToClose()).toBe(true);
  expect(entry.save).not.toHaveBeenCalled();
});
it("awaits manual saves before allowing close", async () => {
  const entry = editor();
  vi.mocked(message).mockResolvedValue("Save");
  expect(await prepareEditorsToClose()).toBe(true);
  expect(entry.save).toHaveBeenCalledOnce();
});
it("rejects failed saves and keeps the dirty editor available for retry", async () => {
  const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const entry = editor({ save, dirty: () => save.mock.calls.length < 2 });
  vi.mocked(message).mockResolvedValue("Save");
  await expect(prepareEditorsToClose()).rejects.toThrow("Could not save");
  expect(entry.dirty()).toBe(true);
  expect(await prepareEditorsToClose()).toBe(true);
});
