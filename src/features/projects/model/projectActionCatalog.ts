import { readTextFile, statFiles } from "../../../platform/tauri/fs";
import { actionExpectedPort, loadProjectActions, type ProjectAction } from "./projectActions";
import {
  detectProjectActionPresets,
  isServerScriptName,
  type ProjectActionPreset,
} from "./projectActionPresets";

export type ProjectActionEntry = {
  name: string;
  command: string;
  url?: string;
  expectedPort?: number;
  /** Long-running local server ("dev mode", localhost); start it as a managed dev server. */
  devServer: boolean;
  /** "saved" is an owner-made top-bar action; manifests are detected suggestions. */
  source: "saved" | ProjectActionPreset["source"];
};

export type ProjectActionCatalog = {
  actions: ProjectActionEntry[];
  /** The best action for "run the project locally", or absent when nothing looks like a server. */
  localServer?: ProjectActionEntry;
};

/** Default IO reads the project folder through the desktop file bridge. */
export const projectActionPresetIO = {
  read: readTextFile,
  exists: (paths: string[]) =>
    statFiles(paths).then((entries) => entries.map((entry) => entry.mtimeMs !== null)),
};

const scriptName = (command: string) =>
  /^(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?([\w:.-]+)\s*$/.exec(command.trim())?.[1];

/**
 * Owner-saved actions first, then manifest scripts they do not already cover. A saved
 * action counts as a server when it is marked so or runs a dev/start/serve script.
 */
export function projectActionCatalog(
  saved: readonly ProjectAction[],
  presets: readonly ProjectActionPreset[],
): ProjectActionCatalog {
  const serverCommands = new Set(
    presets.filter((preset) => preset.devServer).map((preset) => preset.command),
  );
  const entry = (
    value: Pick<ProjectAction, "name" | "command" | "url">,
    devServer: boolean,
    source: ProjectActionEntry["source"],
  ): ProjectActionEntry => {
    const port = actionExpectedPort(value.url);
    return {
      name: value.name,
      command: value.command.trim(),
      ...(value.url.trim() ? { url: value.url.trim() } : {}),
      ...(port ? { expectedPort: port } : {}),
      devServer,
      source,
    };
  };
  const own = saved
    .filter((action) => action.command.trim())
    .map((action) => {
      const script = scriptName(action.command);
      return entry(
        action,
        !!action.devServer ||
          serverCommands.has(action.command.trim()) ||
          isServerScriptName(action.name.trim().toLowerCase()) ||
          (!!script && isServerScriptName(script)),
        "saved",
      );
    });
  const commands = new Set(own.map((action) => action.command));
  const detected = presets
    .filter((preset) => !commands.has(preset.command))
    .map((preset) => entry(preset, !!preset.devServer, preset.source));
  const marked = saved.find((action) => action.devServer && action.command.trim());
  const localServer =
    (marked && own.find((action) => action.command === marked.command.trim())) ??
    own.find((action) => action.devServer) ??
    detected.find((action) => action.devServer);
  return { actions: [...own, ...detected], ...(localServer ? { localServer } : {}) };
}

export async function readProjectActionCatalog(
  cwd: string,
  io = projectActionPresetIO,
): Promise<ProjectActionCatalog> {
  return projectActionCatalog(loadProjectActions(cwd), await detectProjectActionPresets(cwd, io));
}
