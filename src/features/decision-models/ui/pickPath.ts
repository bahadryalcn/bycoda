import { open } from "@tauri-apps/plugin-dialog";

/** Native picker for one model file, program or explicitly requested folder. Returns null on cancel. */
export async function pickPath(options: {
  title: string;
  extensions?: string[];
  directory?: boolean;
}): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: options.directory ?? false,
    title: options.title,
    filters: options.extensions
      ? [{ name: options.title, extensions: options.extensions }]
      : undefined,
  });
  return typeof selected === "string" && selected ? selected : null;
}
