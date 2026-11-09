import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectRail } from "../../src/app/shell/ProjectRail";
import {
  saveProjectGroupAssignments,
  saveProjectGroups,
} from "../../src/features/projects/model/projectGroups";
import { saveProjectRailWidth } from "../../src/features/settings/model/appearance";
import { rememberRemoteProject } from "../../src/features/connections/model/remoteProjects";
import { languageReady } from "../../src/shared/i18n";
import "./project-rail-git.css";

// Browser-local fixture only: fake projects and fake `git_diff_stats` answers. No filesystem, Git or Host.
// ?width=<rail px>  ?flyout (the 320px Projects flyout)  ?theme=light  ?names=<count of extra rows>
const query = new URLSearchParams(location.search);
const flyout = query.has("flyout");
localStorage.setItem("bycoda.language", "en");
document.documentElement.classList.toggle("theme-light", query.get("theme") === "light");
if (query.get("width")) saveProjectRailWidth(Number(query.get("width")));

const STATS: Record<
  string,
  { files: number; additions: number; deletions: number } | "pending" | "fail"
> = {
  clean: { files: 0, additions: 0, deletions: 0 },
  small: { files: 1, additions: 8, deletions: 0 },
  both: { files: 3, additions: 906, deletions: 536 },
  deletions: { files: 2, additions: 0, deletions: 57 },
  huge: { files: 1234, additions: 123456789, deletions: 98765432 },
  binary: { files: 4, additions: 0, deletions: 0 },
  loading: "pending",
  unreachable: "fail",
  "blockblaster-long": { files: 12, additions: 106894, deletions: 1344 },
  "a-very-long-project-name-that-never-ends-and-has-no-spaces-at-all-1234567890": {
    files: 7,
    additions: 301861,
    deletions: 12,
  },
  "Çok uzun proje adı — 日本語のプロジェクト名 🚀 ünïcödé": {
    files: 5,
    additions: 41730,
    deletions: 2,
  },
  app: { files: 2, additions: 12, deletions: 3 },
};
const names = Object.keys(STATS);
const projects = names.map((name) => `G:/fixture/${name}`);
// Two projects share the display name "app": the second sits in another folder.
projects.push("G:/fixture/clients/acme/app");
STATS["app@acme"] = { files: 9, additions: 4200, deletions: 310 };

const machine = {
  id: "fixture-machine",
  name: "tailm",
  endpoint: "http://127.0.0.1:3774",
  environmentId: "fixture-env",
  localHost: false,
};
const remote = rememberRemoteProject(machine.environmentId, {
  id: "remote-1",
  cwd: "/srv/hukukai",
  name: "hukukai",
});
const remotePaths = [remote.key];
STATS[remote.key] = { files: 2, additions: 906, deletions: 536 };

saveProjectGroups([{ id: "team", name: "Team", collapsed: false }]);
const grouped = [projects[2], projects[3], projects[4]];
saveProjectGroupAssignments(
  Object.fromEntries(grouped.map((path) => [path.toLowerCase(), "team"])),
);

Object.assign(window, {
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "fixture" }, currentWebview: { label: "fixture" } },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string, args: { cwd?: string; [key: string]: unknown } = {}) => {
      if (command === "git_diff_stats") {
        const cwd = args.cwd ?? "";
        const key =
          cwd === "G:/fixture/clients/acme/app"
            ? "app@acme"
            : cwd.startsWith("remote://")
              ? remote.key
              : cwd.replace("G:/fixture/", "");
        const value = STATS[key];
        if (value === "pending") return new Promise(() => {});
        if (value === "fail" || !value) throw new Error("fixture: unreachable");
        return value;
      }
      if (command === "remote_machines") return [machine];
      if (command === "remote_request") {
        console.debug("fixture remote_request", JSON.stringify(args).slice(0, 240));
        if (args.method === "workspace.run" && JSON.stringify(args).includes("git_diff_stats"))
          return STATS[remote.key];
        return [];
      }
      if (command === "plugin:event|listen") return 1;
      if (command === "plugin:window|is_visible" || command === "plugin:window|is_focused")
        return true;
      return [];
    },
  },
});

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
await languageReady;
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <div className="flex h-dvh min-w-0 bg-background-base text-content">
      <div
        className={
          flyout
            ? "flex w-80 min-h-0 flex-col border-r border-stroke [&>nav]:w-full!"
            : "flex min-h-0"
        }
      >
        <ProjectRail
          visible
          presentation={flyout ? "navigator" : "panel"}
          resizable={!flyout}
          cwd={projects[1]}
          recents={[...projects, ...remotePaths].map((path, index) => ({
            path,
            openedAt: 1000 - index,
          }))}
          onSelectProject={() => {}}
          onOpenProject={() => {}}
        />
      </div>
      <main className="min-w-0 flex-1 p-4 text-ui-secondary">Fixture content</main>
    </div>
  </QueryClientProvider>,
);
