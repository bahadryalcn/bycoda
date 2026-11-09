// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import { useNoteImageInsertion } from "./useNoteImageInsertion";

const pickImageFiles = vi.hoisted(() => vi.fn());
const saveNoteImagesFromPaths = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../../../platform/tauri/fs", async (original) => ({
  ...(await original<typeof import("../../../platform/tauri/fs")>()),
  pickImageFiles,
}));
vi.mock("../noteImages", async (original) => ({
  ...(await original<typeof import("../noteImages")>()),
  saveNoteImagesFromPaths,
}));

type Api = ReturnType<typeof useNoteImageInsertion>;
type Params = Parameters<typeof useNoteImageInsertion>[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const IMAGE = { name: "shot.png", markdownPath: "/note-assets/shot.png" };

let root: Root;
let container: HTMLDivElement;
let api: Api;

function fakeView(from: number, to: number, length: number) {
  return {
    state: { selection: { main: { from, to } }, doc: { length } },
    focus: vi.fn(),
    dispatch: vi.fn(),
  };
}

function setup(overrides: { closed?: boolean; operationNull?: boolean } = {}) {
  const work = Object.assign(vi.fn(), { apply: vi.fn((callback: () => void) => callback()) });
  const inputOwner = {
    operation: vi.fn(() => (overrides.operationNull ? null : work)),
    closed: vi.fn(() => overrides.closed ?? false),
  };
  const view = fakeView(3, 5, 8);
  const refs = {
    bodyRef: { current: "abcdefgh" },
    modeRef: { current: "split" },
    toolbarTargetRef: { current: "source" as "source" | "preview" },
    editorViewRef: { current: view as unknown as EditorView | null },
    previewViewRef: { current: null as EditorView | null },
    previewRangeRef: { current: null as { from: number; to: number } | null },
  };
  const onInserted = vi.fn();
  const onError = vi.fn();
  const params = {
    noteId: "note-1",
    inputOwner,
    draftState: { edits: { current: {} }, base: { body: "abcdefgh" } },
    ...refs,
    onInserted,
    onError,
  } as unknown as Params;
  function Host() {
    api = useNoteImageInsertion(params);
    return null;
  }
  act(() => root.render(createElement(Host)));
  return { work, inputOwner, view, refs, onInserted, onError };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  pickImageFiles.mockReset();
  saveNoteImagesFromPaths.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("runs one image insertion at a time", async () => {
  const picker = deferred<string[] | null>();
  pickImageFiles.mockReturnValue(picker.promise);
  const { inputOwner, onInserted } = setup();

  let first!: Promise<void>;
  await act(async () => {
    first = api.insertImage();
  });
  expect(api.imageBusy).toBe(true);
  await act(async () => {
    await api.insertImage();
  });
  expect(pickImageFiles).toHaveBeenCalledTimes(1);
  expect(inputOwner.operation).toHaveBeenCalledTimes(1);

  await act(async () => {
    picker.resolve(null);
    await first;
  });
  expect(api.imageBusy).toBe(false);
  expect(onInserted).not.toHaveBeenCalled();
});

it("inserts at the range captured at start and skips focus when the note switched to preview", async () => {
  const picker = deferred<string[] | null>();
  pickImageFiles.mockReturnValue(picker.promise);
  saveNoteImagesFromPaths.mockResolvedValue([IMAGE]);
  const { refs, view, work, onInserted, onError } = setup();

  let pending!: Promise<void>;
  await act(async () => {
    pending = api.insertImage();
  });
  // Caret moves and the mode flips while the dialog is open.
  view.state.selection.main = { from: 0, to: 0 };
  refs.modeRef.current = "preview";

  await act(async () => {
    picker.resolve(["C:/pics/shot.png"]);
    await pending;
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  expect(onError).not.toHaveBeenCalled();
  expect(saveNoteImagesFromPaths).toHaveBeenCalledWith("note-1", ["C:/pics/shot.png"], work);
  expect(onInserted).toHaveBeenCalledTimes(1);
  expect(onInserted).toHaveBeenCalledWith(`abc\n\n![shot.png](/note-assets/shot.png)\n\nfgh`);
  expect(work.apply).toHaveBeenCalledTimes(1);
  expect(view.focus).not.toHaveBeenCalled();
  expect(view.dispatch).not.toHaveBeenCalled();
  expect(work).toHaveBeenCalledTimes(1);
});

it("focuses the source editor after inserting when the mode is still the source", async () => {
  pickImageFiles.mockResolvedValue(["C:/pics/shot.png"]);
  saveNoteImagesFromPaths.mockResolvedValue([IMAGE]);
  const { view, onInserted } = setup();

  await act(async () => {
    await api.insertImage();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  expect(onInserted).toHaveBeenCalledTimes(1);
  expect(view.focus).toHaveBeenCalledTimes(1);
  expect(view.dispatch).toHaveBeenCalledTimes(1);
});

it("reports a rejected image read and clears the busy state", async () => {
  const picker = deferred<string[] | null>();
  pickImageFiles.mockReturnValue(picker.promise);
  const { work, onInserted, onError } = setup();

  let pending!: Promise<void>;
  await act(async () => {
    pending = api.insertImage();
  });
  expect(api.imageBusy).toBe(true);
  await act(async () => {
    picker.reject(new Error("Disk unreadable"));
    await pending;
  });

  expect(onError).toHaveBeenCalledExactlyOnceWith("Disk unreadable");
  expect(onInserted).not.toHaveBeenCalled();
  expect(api.imageBusy).toBe(false);
  expect(work).toHaveBeenCalledTimes(1);

  // A new insertion is accepted again.
  pickImageFiles.mockResolvedValue(null);
  await act(async () => {
    await api.insertImage();
  });
  expect(pickImageFiles).toHaveBeenCalledTimes(2);
});

it("reports an unavailable input owner unless it is closed", async () => {
  const open = setup({ operationNull: true });
  await act(async () => {
    await api.insertImage();
  });
  expect(open.onError).toHaveBeenCalledTimes(1);
  expect(open.onError.mock.calls[0]![0]).toMatch(/busy or unavailable/);
  expect(pickImageFiles).not.toHaveBeenCalled();
  expect(api.imageBusy).toBe(false);

  act(() => root.unmount());
  root = createRoot(container);
  const closed = setup({ operationNull: true, closed: true });
  await act(async () => {
    await api.insertImage();
  });
  expect(closed.onError).not.toHaveBeenCalled();
  expect(pickImageFiles).not.toHaveBeenCalled();
  expect(api.imageBusy).toBe(false);
});

const dropBadge = () => document.querySelector(".pointer-drop-hint")?.textContent ?? null;
function dragEvent(zone: HTMLElement, types: string[], count = types.length) {
  const dataTransfer = {
    types: ["Files"],
    files: [],
    items: types.slice(0, count).map((type) => ({ kind: "file", type })),
    dropEffect: "none",
  };
  return {
    event: {
      preventDefault: vi.fn(),
      clientX: 20,
      clientY: 20,
      currentTarget: zone,
      relatedTarget: null,
      dataTransfer,
    } as never,
    dataTransfer,
  };
}

it("marks the editor body and says Insert image for a dragged image", () => {
  setup();
  const zone = document.createElement("div");
  document.body.append(zone);
  const { event, dataTransfer } = dragEvent(zone, ["image/png"]);
  act(() => api.dropZoneHandlers.onDragOver(event));
  expect(dropBadge()).toBe("Insert image");
  expect(zone.dataset.dropIndicator).toBe("inside");
  expect(dataTransfer.dropEffect).toBe("copy");
  // The in-editor overlay flag stays off: the shared mark and badge are the only feedback.
  expect(api.imageDrag).toBe(false);

  act(() => api.dropZoneHandlers.onDragLeave(event));
  expect(dropBadge()).toBeNull();
  expect(zone.dataset.dropIndicator).toBeUndefined();

  const many = dragEvent(zone, ["image/png", "image/jpeg", ""]);
  act(() => api.dropZoneHandlers.onDragOver(many.event));
  expect(dropBadge()).toBe("Insert 3 images");
  act(() => window.dispatchEvent(new Event("blur")));
  expect(dropBadge()).toBeNull();
  zone.remove();
});

it("refuses files that are not images and says why", () => {
  setup();
  const zone = document.createElement("div");
  document.body.append(zone);
  const { event, dataTransfer } = dragEvent(zone, ["application/pdf"]);
  act(() => api.dropZoneHandlers.onDragOver(event));
  expect(dropBadge()).toBe("Only images can be inserted here");
  expect(zone.dataset.dropIndicator).toBe("blocked");
  expect(dataTransfer.dropEffect).toBe("none");
  act(() =>
    api.dropZoneHandlers.onDrop({ ...(event as object), preventDefault: vi.fn() } as never),
  );
  expect(dropBadge()).toBeNull();
  zone.remove();
});

it("blocks a second drop while an image is still being inserted, and ignores plain text drags", async () => {
  setup();
  const zone = document.createElement("div");
  document.body.append(zone);
  const picker = deferred<string[] | null>();
  pickImageFiles.mockReturnValue(picker.promise);
  let pending!: Promise<void>;
  act(() => {
    pending = api.insertImage();
  });
  const { event } = dragEvent(zone, ["image/png"]);
  act(() => api.dropZoneHandlers.onDragOver(event));
  expect(dropBadge()).toBe("Wait for the current image to finish inserting");
  act(() => api.dropZoneHandlers.onDragLeave(event));

  const text = {
    ...(event as object),
    dataTransfer: { types: ["text/plain"], files: [], items: [] },
  };
  act(() => api.dropZoneHandlers.onDragOver(text as never));
  expect(dropBadge()).toBeNull();
  expect(zone.dataset.dropIndicator).toBeUndefined();

  picker.resolve(null);
  await act(async () => {
    await pending;
  });
  zone.remove();
});
