/**
 * Find-in-editor entry points for the app shell. The real handlers live in
 * `editorSearch`, which pulls in CodeMirror; importing that module from the
 * shell put the whole editor into the boot chunk. The shell imports this
 * instead and the editor code loads shortly after startup (or on first use).
 */
type EditorFind = Pick<
  typeof import("./editorSearch"),
  "handleEditorFindKey" | "openFindInActiveEditor"
>;

let loaded: EditorFind | null = null;
let loading: Promise<void> | null = null;

export function preloadEditorFind(): Promise<void> {
  loading ??= import("./editorSearch").then((module) => {
    loaded = module;
  });
  return loading;
}

/** False until the editor code has loaded; nothing can be focused in an
 * editor before then. */
export function handleEditorFindKey(event: KeyboardEvent): boolean {
  if (!loaded) {
    void preloadEditorFind();
    return false;
  }
  return loaded.handleEditorFindKey(event);
}

export function openFindInActiveEditor(): boolean {
  if (!loaded) {
    void preloadEditorFind();
    return false;
  }
  return loaded.openFindInActiveEditor();
}
