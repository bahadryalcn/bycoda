import { pathKey } from "../../../shared/lib/paths";
import { VoiceActionRefusal } from "./voiceWorkspaceActions";

/**
 * The refusal for `workspace.projects.create` when the folder already exists. It tells the
 * assistant whether that folder is a known project so it can ask the owner to continue it
 * or pick another name, instead of failing silently or improvising another operation.
 */
export function projectNameTaken(
  name: string,
  folderPath: string,
  projectPaths: readonly string[],
): VoiceActionRefusal {
  const existing = projectPaths.find((path) => pathKey(path) === pathKey(folderPath));
  return new VoiceActionRefusal(`A folder for "${name}" already exists: ${folderPath}.`, {
    reason: "name-taken",
    folderPath,
    ...(existing ? { existingProjectPath: existing } : {}),
    options: existing
      ? ["continue-existing-project", "create-with-another-name"]
      : ["create-with-another-name"],
    next: existing
      ? `A project named "${name}" already exists. Ask the owner whether to continue that project (use existingProjectPath) or create a new one with a different name; never create or reuse anything before they answer.`
      : `A folder with this name exists but is not a bycoda project. Ask the owner for a different project name; never reuse the folder.`,
  });
}
