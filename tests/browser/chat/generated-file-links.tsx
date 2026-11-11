import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentMarkdown } from "../../../src/features/sessions/ui/AgentMarkdown";
import { documentKind } from "../../../src/features/files/model/documentViewer";
import "../../../src/styles/index.css";

const cwd = "G:/Projects/Firisbe/UI DEVELOPMENTS/ui-tests";
const directory = `${cwd}/investor-deck`;
const name = "Firisbe-Observer-Yatirimci-Sunumu";
const existing = new Set(
  ["html", "pdf", "docx"].map((extension) => `${directory}/${name}.${extension}`),
);
document.documentElement.classList.toggle(
  "theme-light",
  new URLSearchParams(location.search).get("theme") === "light",
);
Object.assign(window, {
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "fixture" }, currentWebview: { label: "fixture" } },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string, args?: { paths?: string[] }) => {
      if (command === "plugin:event|listen") return 1;
      if (command === "stat_files" || command === "inspect_paths") {
        return (args?.paths ?? []).map((path) => ({
          path,
          mtimeMs: existing.has(path) ? 1 : null,
          isDir: path === directory,
        }));
      }
      if (command === "list_project_files") return [];
      return null;
    },
  },
});

const text = [
  "Sunumu üç formatta hazırladım; hepsi `ui-tests/investor-deck/` klasöründe:",
  "",
  `- \`${name}.html\` — 19 slaytlık, tek dosya.`,
  `- \`${name}.pdf\` — aynı 19 slayt, 16:9 sayfa düzeninde.`,
  `- \`${name}.docx\` — 20 sayfalık A4 belge.`,
].join("\n");

function Fixture() {
  const [opened, setOpened] = useState("");
  const [openCount, setOpenCount] = useState(0);
  return (
    <main style={{ maxWidth: 960, margin: "32px auto", padding: 24 }}>
      <h1 style={{ fontSize: 18, marginBottom: 24 }}>Generated file links · isolated fixture</h1>
      <AgentMarkdown
        text={text}
        cwd={cwd}
        onOpenFile={(path) => {
          setOpened(path);
          setOpenCount((count) => count + 1);
        }}
      />
      <section
        aria-label="File open dispatch"
        style={{
          marginTop: 32,
          padding: 16,
          background: "var(--ui-surface)",
          overflowWrap: "anywhere",
        }}
      >
        <p>Opened path</p>
        <output data-testid="opened-path">{opened || "Choose a file"}</output>
        <output className="sr-only" data-testid="open-count" aria-label="Open count">
          {openCount}
        </output>
        {opened && <p data-testid="viewer-kind">Viewer: {documentKind(opened) ?? "html"}</p>}
      </section>
      <p style={{ marginTop: 24 }}>
        Filesystem metadata is mocked. This checks real Markdown interaction and dispatch; it does
        not launch the installed app or parse document bytes.
      </p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
