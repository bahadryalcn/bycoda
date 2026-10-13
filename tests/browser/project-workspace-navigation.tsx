import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ProjectRail } from "../../src/app/shell/ProjectRail";
import { SourceControl } from "../../src/features/source-control/ui/SourceControl";
import {
  saveProjectGroups,
  saveProjectGroupAssignments,
} from "../../src/features/projects/model/projectGroups";
import { savePinnedProjects } from "../../src/features/projects/model/recents";
import { languageReady } from "../../src/shared/i18n";
import "../../src/styles/index.css";

// Exercise the production rail without changing a real repository or session.
saveProjectGroups([
  {
    id: "wallet",
    name: "wallet",
    collapsed: false,
    workspaceFile: "G:/wallet/wallet.code-workspace",
    workspaceFolders: ["G:/wallet/api", "G:/wallet/mobile"],
  },
  { id: "team", name: "Team", collapsed: false },
]);
saveProjectGroupAssignments({
  "g:/wallet/api": "wallet",
  "g:/wallet/mobile": "wallet",
  "g:/team/service": "team",
});
savePinnedProjects(["G:/wallet"]);
function Fixture() {
  const [cwd, setCwd] = useState("G:/wallet/api");
  const [review, setReview] = useState("");
  const [renamedFolder, setRenamedFolder] = useState("");
  return (
    <div className="flex h-screen bg-background-base text-content">
      <ProjectRail
        visible
        cwd={cwd}
        recents={["G:/wallet", "G:/wallet/api", "G:/wallet/mobile", "G:/team/service"].map(
          (path) => ({ path, openedAt: 1 }),
        )}
        onSelectProject={setCwd}
        onOpenProject={() => {}}
        onRenameProjectFolder={async (path, name) => {
          setRenamedFolder(`${path}:${name}`);
        }}
      />
      <div className="flex h-full w-[520px] min-w-0 flex-col border-e border-stroke">
        <output aria-label="Selected project" className="p-3">
          {cwd}
        </output>
        <SourceControl
          cwd={cwd}
          enabled
          repositoryPaths={cwd === "G:/wallet" ? ["G:/wallet/api", "G:/wallet/mobile"] : undefined}
          onOpenRepository={(request) =>
            setReview(
              `${request.type}:${request.cwd}:${"path" in request ? (request.path ?? "all") : request.commit.sha}`,
            )
          }
          onOpenFile={() => {}}
          onOpenAllChanges={() => {}}
          onOpenCommit={() => {}}
        />
      </div>
      <output aria-label="Selected review" className="p-3">
        {review}
      </output>
      <output aria-label="Renamed folder">{renamedFolder}</output>
    </div>
  );
}
await languageReady;
createRoot(document.getElementById("root")!).render(<Fixture />);
