import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useProjectMenu } from "../../src/app/shell/useProjectMenu";
import {
  saveProjectGroups,
  saveProjectGroupAssignments,
} from "../../src/features/projects/model/projectGroups";
import { pathKey } from "../../src/shared/lib/paths";
import "../../src/styles/index.css";

// Browser-local storage only; the fixture never removes files or calls a host.
function Fixture() {
  useEffect(() => {
    saveProjectGroups([
      {
        id: "fixture",
        name: "Design / Creative",
        collapsed: false,
        workspaceFile: "/fixture/example.code-workspace",
      },
    ]);
    saveProjectGroupAssignments({ [pathKey("/fixture/design")]: "fixture" });
  }, []);
  const menu = useProjectMenu({
    projectPaths: ["/fixture/design"],
    onRemoveProject: async () => {},
  });
  return (
    <main className="h-full bg-background-base p-4 text-content">
      <button type="button" onClick={() => menu.openGroupMenu("fixture", 16, 80)}>
        Open left
      </button>
      <button
        type="button"
        onClick={() => menu.openGroupMenu("fixture", window.innerWidth - 16, 80)}
      >
        Open right
      </button>
      <button
        type="button"
        onClick={() =>
          menu.openGroupMenu("fixture", window.innerWidth - 16, window.innerHeight - 16)
        }
      >
        Open bottom
      </button>
      {menu.element}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
