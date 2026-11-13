import { createRoot } from "react-dom/client";
import { FolderPicker } from "../../../src/features/projects/ui/FolderPicker";
import "../../../src/styles/index.css";

// Fixture evidence only. Filesystem calls use memory data; no native or Host access.
createRoot(document.getElementById("root")!).render(
  <FolderPicker title="Add folders" multiple onPick={() => {}} onClose={() => {}} />,
);
