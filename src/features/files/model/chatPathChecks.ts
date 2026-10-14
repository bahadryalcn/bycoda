import { statFiles } from "../../../platform/tauri/fs";

// Ambiguous inline spans such as `src/components` need an existence check so
// protocol methods such as `currentTime/read` keep their ordinary code styling.
// Collect all spans rendered in one frame into one metadata request.
let pending = new Map<string, ((exists: boolean) => void)[]>();
export function existingChatPath(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const scheduled = pending.size > 0;
    const listeners = pending.get(path) ?? [];
    listeners.push(resolve);
    pending.set(path, listeners);
    if (scheduled) return;
    queueMicrotask(async () => {
      const batch = pending;
      pending = new Map();
      const paths = [...batch.keys()];
      for (let offset = 0; offset < paths.length; offset += 200) {
        const chunk = paths.slice(offset, offset + 200);
        const infos = await statFiles(chunk).catch(() => []);
        const existing = new Set(
          infos.filter((info) => info.isDir || info.mtimeMs != null).map((info) => info.path),
        );
        for (const path of chunk) {
          for (const resolve of batch.get(path) ?? []) resolve(existing.has(path));
        }
      }
    });
  });
}
