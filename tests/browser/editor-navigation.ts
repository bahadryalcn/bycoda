import { EditorView } from "@codemirror/view";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { languageForPath } from "../../src/features/files/editor/editorLanguage";
import { editorLint, syntaxDiagnostics } from "../../src/features/files/editor/editorLint";
import { editorNavigation } from "../../src/features/files/editor/editorNavigation";

const files: Record<string, string> = {
  "/fixture/jsconfig.json": '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}',
  "/fixture/src/refund.js": "export function refund() { return true; }",
};
Object.assign(window, {
  __TAURI_INTERNALS__: {
    invoke: async (command: string, args: { path?: string; paths?: string[] }) => {
      if (command === "stat_files")
        return args.paths!.map((path) => ({ path, mtimeMs: path in files ? 1 : null }));
      if (command === "read_text_file" && args.path! in files) return files[args.path!];
      throw new Error("Missing fixture file");
    },
  },
});
const source =
  'import { refund as runRefund } from "@/refund";\nconst onClick = () => runRefund();\nconst content = <TransactionRefundDialog refetchTransactionReport={onClick} setIsLoading={() => {}} />;';
const view = new EditorView({
  doc: source,
  parent: document.querySelector("#editor")!,
  extensions: [
    (await languageForPath("/fixture/src/Dialog.js"))!,
    syntaxHighlighting(defaultHighlightStyle),
    editorLint("/fixture/src/Dialog.js", (count) => {
      document.querySelector("#errors")!.textContent = String(count);
    }),
    editorNavigation("/fixture", "/fixture/src/Dialog.js", (path, location) => {
      document.querySelector("#navigation")!.textContent = JSON.stringify({ path, ...location });
    }),
  ],
});
Object.assign(window, {
  editorFixture: {
    point: (needle: string) => {
      const position = source.lastIndexOf(needle) + 2;
      const rect = view.coordsAtPos(position)!;
      return { x: rect.left, y: (rect.top + rect.bottom) / 2 };
    },
    head: () => view.state.selection.main.head,
    definition: source.indexOf("onClick"),
  },
});
document.querySelector("#errors")!.textContent = String(syntaxDiagnostics(view.state).length);
