import { createRoot } from "react-dom/client";
import { CodeMirrorEditor } from "../../src/features/files/ui/CodeMirrorEditor";
import { handleEditorFindKey } from "../../src/features/files/editor/editorSearch";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import "../../src/styles/index.css";

const context = Array.from({ length: 28 }, (_, i) => `unchanged context ${i}`).join("\n");
const incoming = new URLSearchParams(location.search).has("hash")
  ? "b".repeat(40)
  : "feature/pricing";
const markers = `start\n<<<<<<< HEAD\nprice=100\n=======\nprice=120\n>>>>>>> ${incoming}\n${context}\n<<<<<<< HEAD\nname=current\n=======\nname=incoming\n>>>>>>> ${incoming}\nend\n`;
const base = `start\nprice=80\n${context}\nname=base\nend\n`;
const calls: { command: string; args: Record<string, unknown> }[] = [];
Object.assign(window, {
  mergeCalls: calls,
  __TAURI_INTERNALS__: {
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      calls.push({ command, args });
      if (command === "git_conflict_stages") return { base, binary: false, tooLarge: false };
      if (command === "git_operation_state") return "merge";
      if (command === "git_branches") return { current: "main", detached: false, branches: [] };
      if (command === "git_history")
        return {
          head: "a".repeat(40),
          commits: [
            {
              sha: "a".repeat(40),
              shortSha: "aaaaaaa",
              parents: [],
              author: "Alice",
              timestamp: 1,
              subject: "Update existing prices",
              refs: [{ name: "main", kind: "local" }],
              head: true,
            },
            {
              sha: "b".repeat(40),
              shortSha: "bbbbbbb",
              parents: [],
              author: "Bob",
              timestamp: 2,
              subject: "Introduce new pricing",
              refs: [
                { name: "incoming-price", kind: "local" },
                { name: "feature/pricing", kind: "local" },
              ],
              head: false,
            },
          ],
        };
      if (command === "git_stage_file") return;
      throw new Error(`Unexpected fixture command: ${command}`);
    },
  },
});
applyThemePreference(new URLSearchParams(location.search).has("light") ? "light" : "dark");
window.addEventListener("keydown", handleEditorFindKey, true);
document.body.style.cssText =
  "margin:0;height:100vh;background:var(--ui-surface);color:var(--color-content)";
createRoot(document.getElementById("root")!).render(
  <main className="flex min-w-0 flex-col" style={{ height: "100dvh" }}>
    <CodeMirrorEditor
      path="/fixture/prices.txt"
      cwd="/fixture"
      commentPath="prices.txt"
      value={markers}
      showDiff={false}
      gitOriginal={null}
      active
      onDirtyChange={() => {}}
      onErrorCountChange={() => {}}
      canAutosave={() => true}
      onSave={async (content) => {
        calls.push({ command: "write_text_file", args: { content } });
      }}
    />
  </main>,
);
