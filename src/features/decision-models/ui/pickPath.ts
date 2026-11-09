import { open } from "@tauri-apps/plugin-dialog";

/** Native file picker for one model file or program. Returns null when the user cancels. */
export async function pickPath(options: {
  title: string;
  extensions?: string[];
}): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: options.title,
    filters: options.extensions
      ? [{ name: options.title, extensions: options.extensions }]
      : undefined,
  });
  return typeof selected === "string" && selected ? selected : null;
}
