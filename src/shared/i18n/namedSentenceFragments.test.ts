import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Regression for #641: these shell and connection sentences were joined from separate
// translated fragments around a dynamic value. Each must be one whole message with a slot,
// and the fragment keys must not survive in any catalog.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "../..");
const localesDir = join(here, "locales");

const SURFACES = [
  "app/shell/Sidebar.tsx",
  "app/shell/UpdateRailCard.tsx",
  "app/shell/UsageProviderChip.tsx",
  "features/connections/ui/MachineForm.tsx",
  "features/connections/ui/RemoteLoadError.tsx",
  "features/connections/ui/RemoveMachineDialog.tsx",
  "features/providers/model/harnessUpdateActions.ts",
  "features/providers/ui/HarnessUpdateNotice.tsx",
  "features/files/ui/CodeMirrorEditor.tsx",
  "features/files/ui/FileEditor.tsx",
  "features/files/ui/SheetGridView.tsx",
  "features/search/ui/SearchView.tsx",
  "features/source-control/ui/UnifiedDiffView.tsx",
  "features/source-control/ui/WorktreeRow.tsx",
  "features/orchestration/ui/OrchestrationSidebarAgents.tsx",
  "features/inbox/ui/CheckEvidence.tsx",
  "features/automations/ui/TriggerEditor.tsx",
  "features/tasks/ui/GoalCard.tsx",
];

const FRAGMENTS = [
  "Add ",
  " account",
  " accounts",
  " selected",
  "Use ",
  " instead of the IP",
  "Updated to ",
  "Reconnecting failed: ",
  "on that machine (",
  " starts.",
  " on this computer. It is created again automatically the next time",
  "Application-wide indexing",
  "Indexing ",
  " conversation",
  ". Results may be incomplete.",
  "Showing the first ",
  " of",
  " rows and",
  " columns.",
  "Blame unavailable: ",
  "Save failed: ",
  " session",
  " in this worktree",
  " unpublished commit",
  " unmodified ",
  " done",
  " is still running in this project.",
  " more annotations",
  "Show ",
];

const MESSAGES = [
  "Add {p0} account",
  "Use {p0} instead of the IP",
  "Updated to {p0}",
  "Reconnecting failed: {p0}",
  "Reconnecting failed",
  "Removing this stops syncing projects and groups with the {p0} on this computer. It is created again automatically the next time {p1} starts.",
  "To stop the host and turn off its background service, run {p0} on that machine ({p1} on Windows). Its sessions and history are kept.",
  "Application-wide indexing: Indexing {p0} conversation. Results may be incomplete.",
  "Application-wide indexing: Indexing {p0} conversations. Results may be incomplete.",
  "Showing the first {p0} of {p1} rows and {p2} of {p3} columns.",
  "Cell/text preview budget reached; some values are omitted or shortened. Open the original file to see all values.",
  "Save failed: {p0}",
  "Blame unavailable: {p0}",
  "{p0} session in this worktree",
  "{p0} sessions in this worktree",
  "{p0} unpublished commit",
  "{p0} unpublished commits",
  "{p0} unmodified line",
  "{p0} unmodified lines",
  "{p0}/{p1} done",
  "{p0} agent",
  "{p0} is still running in this project.",
  "Show {p0} more annotation",
  "Show {p0} more annotations",
  "Next run {p0}",
];

const LOCALES = ["de", "en", "es", "fr", "ja", "pt", "tr", "zh-CN"];

describe("named sentences use whole messages", () => {
  it.each(SURFACES)("%s has no translated sentence fragment", (file) => {
    const source = readFileSync(join(srcDir, file), "utf8");

    for (const fragment of FRAGMENTS) {
      expect(source, fragment).not.toContain(`t("${fragment}")`);
    }
  });

  it.each(LOCALES)("%s catalog has the whole messages and no fragment keys", (locale) => {
    const catalog = JSON.parse(readFileSync(join(localesDir, `${locale}.json`), "utf8")) as Record<
      string,
      string
    >;

    for (const message of MESSAGES) {
      expect(catalog[message], message).toEqual(expect.any(String));
    }
    for (const fragment of FRAGMENTS) {
      expect(catalog, fragment).not.toHaveProperty(fragment);
    }
  });
});
