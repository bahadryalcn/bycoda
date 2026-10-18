import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { WorktreesPage } from "../../src/features/source-control/ui/WorktreesPage";
import type { Worktree } from "../../src/features/source-control/model/worktrees";
import { Modal } from "../../src/shared/ui/Modal";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import { setLanguagePreference, setDomainLanguagePreference } from "../../src/shared/i18n";
import "../../src/styles/index.css";

// In-memory transport only. No owner host, filesystem or native deletion is reachable.
mockWindows("main");
const makeTree = (name: string, branch: string, state: Partial<Worktree> = {}): Worktree => ({
  path: `/fixture/worktrees/${name}`,
  branch,
  head: "abc1234",
  isMain: false,
  locked: false,
  missing: false,
  prunable: false,
  unpushed: 0,
  dirty: false,
  sessionIds: [],
  ...state,
});
const trees = [
  makeTree("settings-project", "main", { path: "/fixture/settings-project", isMain: true }),
  makeTree("fix-go-to-file-deleted-paths", "fix/go-to-file-deleted-paths"),
  makeTree("wt-mc-851db1b6", "mc/851db1b6", {
    dirty: true,
    unpushed: 1,
    sessionIds: ["one", "two"],
  }),
  makeTree("missing-worktree", "fix/missing", { missing: true, dirty: null }),
  makeTree("long-project-name-".repeat(6), "feature/" + "long-branch-name-".repeat(6), {
    locked: true,
  }),
];
mockIPC((command) => {
  if (command.startsWith("plugin:event|")) return null;
  if (command === "git_worktrees") return { worktrees: trees, defaultRoot: "/fixture/worktrees" };
  if (command === "remote_machines" || command === "git_branches") return [];
  throw new Error(`Unmocked worktree fixture command: ${command}`);
});
applyThemePreference(
  new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark",
);
void Promise.all([setLanguagePreference("en"), setDomainLanguagePreference("git", "app")]).then(
  () => {
    createRoot(document.getElementById("root")!).render(
      <main className="min-h-screen bg-background-base p-6 text-content">
        <Modal title="Worktrees" size="lg" onClose={() => {}}>
          <div className="p-4">
            <WorktreesPage
              cwd="/fixture/settings-project"
              onRemove={async () => {
                throw new Error("Deletion is disabled in this fixture");
              }}
            />
          </div>
        </Modal>
      </main>,
    );
  },
);
