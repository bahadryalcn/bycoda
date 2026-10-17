import { createRoot } from "react-dom/client";
import { CodeMirrorEditor } from "../../src/features/files/ui/CodeMirrorEditor";
import { handleEditorFindKey } from "../../src/features/files/editor/editorSearch";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import "../../src/styles/index.css";

const context = Array.from({ length: 28 }, (_, i) => `unchanged context ${i}`).join("\n");
const markers = `start\n<<<<<<< HEAD\nprice=100\n=======\nprice=120\n>>>>>>> incoming-price\n${context}\n<<<<<<< HEAD\nname=current\n=======\nname=incoming\n>>>>>>> incoming-price\nend\n`;
const base = `start\nprice=80\n${context}\nname=base\nend\n`;
const calls: { command: string; args: Record<string, unknown> }[] = [];
Object.assign(window, {
  mergeCalls: calls,
  __TAURI_INTERNALS__: {
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      calls.push({ command, args });
      if (command === "git_conflict_stages") return { base, binary: false, tooLarge: false };
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
