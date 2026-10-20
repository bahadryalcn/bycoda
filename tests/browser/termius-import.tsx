import { createRoot } from "react-dom/client";
import { useState } from "react";
import { TermiusImportDialog } from "../../src/features/connections/ui/TermiusImportDialog";
import { Button } from "../../src/shared/ui/Button";
import { setLanguagePreference } from "../../src/shared/i18n";
import type { ServerRecord } from "../../src/features/connections/model/serverInventory";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.has("light"));
setLanguagePreference(params.has("tr") ? "tr" : "en");
const requests: { command: string; input: Record<string, unknown> }[] = [];
let fail = params.has("error");
const hosts = [
  {
    sourceId: "one",
    name: "Production application server with a long descriptive label",
    endpoint: { host: "prod.example.invalid", user: "admin", port: 2222 },
    hasKey: true,
    needsPassword: false,
    requiresReview: false,
    group: "Production / Europe",
    tags: ["application", "ops"],
    warnings: [],
  },
  {
    sourceId: "two",
    name: "Existing database",
    endpoint: { host: "db.example.invalid", port: 22 },
    hasKey: false,
    needsPassword: true,
    requiresReview: false,
    tags: [],
    warnings: ["Enter the server password when connecting"],
  },
  {
    sourceId: "three",
    name: "Internal proxy target",
    endpoint: { host: "internal.example.invalid", port: 22 },
    hasKey: false,
    needsPassword: false,
    requiresReview: true,
    tags: [],
    warnings: ["Proxy settings require review"],
  },
];
const existing: ServerRecord[] = [
  {
    id: "existing",
    kind: "ssh",
    name: "Keep database",
    sshEndpoint: { host: "db.example.invalid", port: 22 },
    metadata: { tags: ["keep"], favorite: true },
  },
];
Object.assign(window, {
  __termiusRequests: requests,
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string, input: Record<string, unknown> = {}) => {
      requests.push({ command, input });
      if (command === "termius_import_preview") {
        if (fail) {
          fail = false;
          throw "Could not read Termius. Close Termius and try again.";
        }
        return {
          ticket: "preview-ticket",
          hosts,
          warnings: ["Saved passwords, port forwards and snippets are not imported."],
        };
      }
      if (command === "termius_import_apply") {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (params.has("expired")) throw "Migration preview expired. Scan Termius again.";
        return { imported: 1, skipped: 0, keys: input.importKeys ? 1 : 0 };
      }
      if (command === "termius_import_forget") return null;
      throw new Error(`Unexpected fixture command: ${command}`);
    },
  },
});
function Fixture() {
  const [shown, setShown] = useState(true);
  return shown ? (
    <TermiusImportDialog servers={existing} onClose={() => setShown(false)} />
  ) : (
    <Button onClick={() => setShown(true)}>Open import</Button>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
