// @vitest-environment happy-dom
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editorNavigation, referenceAt, resolveEditorModule } from "./editorNavigation";
import { readTextFile, statFiles } from "../../../platform/tauri/fs";

vi.mock("../../../platform/tauri/fs", () => ({
  readTextFile: vi.fn(),
  statFiles: vi.fn(),
  basename: (path: string) => path.split("/").pop(),
}));
afterEach(() => vi.resetAllMocks());
function state(doc: string) {
  return EditorState.create({ doc, extensions: [javascript({ jsx: true, typescript: true })] });
}
function ioFor(files: Record<string, string>) {
  return {
    read: vi.fn(async (path: string) => {
      if (!(path in files)) throw new Error("missing");
      return files[path];
    }),
    stat: vi.fn(async (paths: string[]) =>
      paths.map((path) => ({ path, mtimeMs: path in files ? 1 : null })),
    ),
  };
}

describe("editor references", () => {
  it("opens import strings, reexports, require and dynamic imports", () => {
    for (const doc of [
      'import "./dialog";',
      'export { Dialog } from "./dialog";',
      'const dialog = require("./dialog");',
      'const dialog = import("./dialog");',
    ]) {
      expect(referenceAt(state(doc), doc.indexOf("./dialog") + 2), doc).toEqual({
        module: "./dialog",
      });
    }
  });
  it("follows named aliases, default imports and JSX components", () => {
    const doc =
      'import Dialog from "./dialog"; import { refund as run } from "./service"; run(); const ui = <Dialog />;';
    expect(referenceAt(state(doc), doc.indexOf("run();") + 1)).toEqual({
      module: "./service",
      name: "refund",
    });
    expect(referenceAt(state(doc), doc.lastIndexOf("Dialog") + 1)).toEqual({
      module: "./dialog",
      name: "default",
    });
  });
  it("resolves the closest lexical definition rather than a same-named sibling", () => {
    const doc =
      "const value = 1; function other() { const value = 2; } function run(value) { return value; } value;";
    expect(referenceAt(state(doc), doc.indexOf("return value") + 8)).toEqual({
      offset: doc.indexOf("run(value") + 4,
    });
    expect(referenceAt(state(doc), doc.lastIndexOf("value") + 1)).toEqual({
      offset: doc.indexOf("value"),
    });
  });
  it("does not navigate comments, arbitrary strings or member properties", () => {
    const doc = 'const value = 1; // value\nconst text = "value"; object.value;';
    for (const position of [
      doc.indexOf("// value") + 4,
      doc.indexOf('"value"') + 2,
      doc.lastIndexOf("value") + 1,
    ]) {
      expect(referenceAt(state(doc), position)).toBeNull();
    }
  });
});

describe("module resolution", () => {
  it("resolves relative files, index files and explicit JS imports to TS source", async () => {
    const io = ioFor({
      "/repo/src/Dialog.jsx": "",
      "/repo/src/util/index.ts": "",
      "/repo/src/service.ts": "",
    });
    expect(await resolveEditorModule("/repo", "/repo/src/app.js", "./Dialog", io)).toBe(
      "/repo/src/Dialog.jsx",
    );
    expect(await resolveEditorModule("/repo", "/repo/src/app.js", "./util", io)).toBe(
      "/repo/src/util/index.ts",
    );
    expect(await resolveEditorModule("/repo", "/repo/src/app.js", "./service.js", io)).toBe(
      "/repo/src/service.ts",
    );
  });
  it("uses JSONC path aliases and baseUrl without evaluating project config", async () => {
    const io = ioFor({
      "/repo/jsconfig.json":
        '{ // alias\n "compilerOptions": {"baseUrl":".", "paths": {"@/*": ["src/*"],},},}',
      "/repo/src/Dialog.js": "",
    });
    expect(await resolveEditorModule("/repo", "/repo/src/app.js", "@/Dialog", io)).toBe(
      "/repo/src/Dialog.js",
    );
    expect(await resolveEditorModule("/repo", "/repo/src/app.js", "src/Dialog", io)).toBe(
      "/repo/src/Dialog.js",
    );
  });
  it("preserves connected-machine identity", async () => {
    const io = ioFor({ "remote://mac/Users/me/repo/src/Dialog.tsx": "" });
    expect(
      await resolveEditorModule(
        "remote://mac/Users/me/repo",
        "remote://mac/Users/me/repo/src/App.tsx",
        "./Dialog",
        io,
      ),
    ).toBe("remote://mac/Users/me/repo/src/Dialog.tsx");
  });
  it("returns no guessed target when a module is missing", async () => {
    expect(await resolveEditorModule("/repo", "/repo/app.js", "missing", ioFor({}))).toBeNull();
  });
});

describe("editor gesture", () => {
  it("F12 jumps to a local declaration without opening another tab", () => {
    const source = "const value = 1; value;";
    const open = vi.fn();
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      doc: source,
      selection: { anchor: source.lastIndexOf("value") + 1 },
      extensions: [javascript(), editorNavigation("/repo", "/repo/app.js", open)],
    });
    try {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "F12", keyCode: 123, bubbles: true, cancelable: true }),
      );
      expect(view.state.selection.main.head).toBe(source.indexOf("value"));
      expect(open).not.toHaveBeenCalled();
    } finally {
      view.destroy();
      parent.remove();
    }
  });
  it("follows a barrel reexport and renamed export to the source definition", async () => {
    const source = 'import { run } from "./index"; run();';
    const io = ioFor({
      "/repo/index.js": 'export { refund as run } from "./service";',
      "/repo/service.js": "const refund = () => {};\nexport { refund };",
    });
    vi.mocked(readTextFile).mockImplementation(io.read);
    vi.mocked(statFiles).mockImplementation(io.stat);
    const open = vi.fn();
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      doc: source,
      selection: { anchor: source.lastIndexOf("run") + 1 },
      extensions: [javascript(), editorNavigation("/repo", "/repo/app.js", open)],
    });
    try {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "F12", keyCode: 123, bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() =>
        expect(open).toHaveBeenCalledWith(
          "/repo/service.js",
          { line: 1, column: 7 },
          { exact: true },
        ),
      );
    } finally {
      view.destroy();
      parent.remove();
    }
  });
  it("drops pending navigation when the editor is destroyed", async () => {
    let finish!: (value: Awaited<ReturnType<typeof statFiles>>) => void;
    vi.mocked(statFiles).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const open = vi.fn();
    const source = 'import "./service";';
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      doc: source,
      selection: { anchor: 11 },
      extensions: [javascript(), editorNavigation("/repo", "/repo/app.js", open)],
    });
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F12", keyCode: 123, bubbles: true, cancelable: true }),
    );
    view.destroy();
    parent.remove();
    finish([{ path: "/repo/service.js", mtimeMs: 1 }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(open).not.toHaveBeenCalled();
  });
  it.each(["ctrlKey", "metaKey"])(
    "opens the imported definition with %s and ignores ordinary clicks",
    async (modifier) => {
      const source = 'import { refund as run } from "./service"; run();';
      const io = ioFor({ "/repo/service.js": "export function refund() {}" });
      vi.mocked(readTextFile).mockImplementation(io.read);
      vi.mocked(statFiles).mockImplementation(io.stat);
      const open = vi.fn();
      const parent = document.createElement("div");
      document.body.append(parent);
      const view = new EditorView({
        parent,
        doc: source,
        extensions: [javascript(), editorNavigation("/repo", "/repo/app.js", open)],
      });
      vi.spyOn(view, "posAtCoords").mockReturnValue(source.lastIndexOf("run") + 1);
      try {
        view.contentDOM.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );
        expect(open).not.toHaveBeenCalled();
        view.contentDOM.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true, [modifier]: true }),
        );
        await vi.waitFor(() =>
          expect(open).toHaveBeenCalledWith(
            "/repo/service.js",
            { line: 1, column: 17 },
            { exact: true },
          ),
        );
      } finally {
        view.destroy();
        parent.remove();
      }
    },
  );
});
